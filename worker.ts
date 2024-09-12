import pg from 'pg';
import Square, {CatalogApi,OrdersApi,CustomersApi   } from 'square';
import {nanoid} from 'nanoid';
import {sendemail,EmailBody,EmailHeader} from './sendemail'
import {UpdateOrderRequest} from 'square/dist/models/updateOrderRequest'
import {SearchOrdersRequest } from 'square/dist/models/searchOrdersRequest';
import { SearchOrdersQuery } from 'square/dist/models/searchOrdersQuery';
import { SearchOrdersFilter } from 'square/dist/models/searchOrdersFilter';
import { SearchOrdersFulfillmentFilter } from 'square/dist/models/searchOrdersFulfillmentFilter';
/// <reference path="./types/legit/legit.d.ts" />
import legit from 'legit'
import {jsonParseIfStringified} from './api/stringUtils'
//import { SearchOrdersQuery, SearchOrdersRequest, SearchOrdersFulfillmentFilter, SearchOrdersFilter } from 'square-connect';
//import { UpdateOrderRequest, Order } from 'square-connect';

const notificationEmail = process.env.NOTIFICATION_RECIPIENT || 'guy.berliner@gmail.com'
const squareUrlPrefix = 'https://squareup'
const squareUrlDashboardPrefix = '.com/dashboard/orders/overview/'
const squareUrlDashboardCustPrefix = '.com/dashboard/customers/directory/customer/'
const configSandbox: Partial<Square.Configuration> = {
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: Square.Environment.Sandbox,
    customUrl: "https://connect.squareupsandbox.com"
}
const configProd: Partial<Square.Configuration> = {
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: Square.Environment.Production
}
let configSquare = configSandbox;
if (process.env.NODE_ENV === "production" && process.env.STAGING !== 'true') {
    configSquare = configProd
}

const sqClient = new Square.Client(configSquare)
const connectionString = process.env.DATABASE_URL
const pgPool = new pg.Pool({
    connectionString
})

type VendorOrderInfo = {
    sqorderid: string;
    custid: string;
    sqid: string;
    customwords: string;
    year: string;
}

async function checkForAndCreateCustomerInSquare(row: any,client: Square.Client, pgclient: pg.Pool,rowFromCustomer: boolean) {
    let email = row[rowFromCustomer?'email':'custemail'];
    let origEmail = email
    email = jsonParseIfStringified(email)
    let note: string = ""
    let legitRes = await legit(email);
    if (!legitRes.isValid) {
        console.warn(`User email address ${email}, no valid mx!`)
        note = `The email this user specified, ${email}, was not valid`;
        email = "fakeaddr-" + Date.now().toString() + "@example.com"
    }

    let searchFilter: Square.SearchCustomersRequest = {

    }
    
    let emailQuery: Square.CustomerQuery = {

    }
    let emailQueryFilter: Square.CustomerFilter = {
        emailAddress: {
            exact: email
        }
    }
    emailQuery.filter = emailQueryFilter
    searchFilter.query = emailQuery;
    searchFilter.limit = BigInt(1);
    let customerRes = await client.customersApi.searchCustomers(searchFilter)
    let phone: string = ""
    let customerLocal;
    let firstname: string = ""
    let lastname: string = ""

    if (rowFromCustomer) {
        phone=row['phone']
        firstname=row['firstname']
        lastname=row['lastname']
    }

    if (!rowFromCustomer) {
        customerLocal = await pgPool.query(`select * from Customer where email='${origEmail}'`)
        if (customerLocal.rowCount >= 1) {
            phone = customerLocal.rows[0]['phone']
        }    
    }
    if (rowFromCustomer || 0 === customerRes.result.customers?.length) {
        
        let createCustomerRequest: Square.CreateCustomerRequest = {

        }
        createCustomerRequest.address = {
            addressLine1: jsonParseIfStringified(row["address"]),
            firstName: jsonParseIfStringified(firstname),
            lastName: jsonParseIfStringified(lastname),
            
        }
        if (note !== "") {
            createCustomerRequest.note = jsonParseIfStringified(note)
        }
        createCustomerRequest.emailAddress = email
        createCustomerRequest.phoneNumber = "1" + phone
        createCustomerRequest.givenName = jsonParseIfStringified(firstname)
        createCustomerRequest.familyName = jsonParseIfStringified(lastname)
        let sqCustRes = await client.customersApi.createCustomer(createCustomerRequest)
        let sqid = ""
        if (sqCustRes?.result !== undefined && sqCustRes?.result?.customer !== undefined && sqCustRes?.result?.customer.id !== undefined) {
            sqid = sqCustRes.result.customer.id;
            await pgPool.query(`update customer set sqid='${sqid}' where email='${origEmail}'`)
        }
    }
}

export async function populateCustomersInSquare() {
    
    try{

        let res = await pgPool.query("select * from customer where sqid is null")
        if (res.rowCount > 0) {
            await Promise.all(((ra: Array<unknown>): Array<Promise<unknown >> =>{
                let promiseRa = new Array<Promise<unknown > >(ra.length);
                ra.forEach(async (row)=>{
                    promiseRa.push(checkForAndCreateCustomerInSquare(row, sqClient, pgPool, true))
                })
                return promiseRa;
            })(res.rows))    
        }
    } catch(error) {
        console.error(error)
    }
}

// to be run as scheduled job
export async function reportNewOrders(){

    let newOrders:  Array<string>
 

    try {

        let results = await pgPool.query(`select * from custorders join customer on custorders.custid=customer.id where status='new' OR status='PROPOSED';`)
        if (results.rowCount >= 3) {
            await Promise.all(((ra: Array<unknown>): Array<Promise<unknown >> =>{
                let promiseRa = new Array<Promise<unknown > >(ra.length);
                ra.forEach(async (row)=>{
                    promiseRa.push(checkForAndCreateCustomerInSquare(row, sqClient, pgPool, false))
                })
                return promiseRa;
            })(results.rows))
        } else {
            throw(new Error('too few orders to act on'))            
        }
        let resultsFromDb = await pgPool.query("select sqorderid from custorders where status='new' OR status='PROPOSED';");
        newOrders = new Array<string>(resultsFromDb.rowCount)
        resultsFromDb.rows.forEach((row,idx)=>{
            newOrders[idx] = row['sqorderid']
        })
        let retrieveOrderRequest: Square.BatchRetrieveOrdersRequest = {
            orderIds: newOrders
        }

        console.error(`Orders ${newOrders.join(" ")} ready for treasurer review`)
        let newSqOrders = await sqClient.ordersApi.batchRetrieveOrders(retrieveOrderRequest)
        await Promise.all(((ra: Square.Order[]): Array<Promise<unknown>> => {
            let promiseRa = new Array<Promise<unknown>>(ra.length);
            ra.forEach(async (order: Square.Order,idx) => {
                if (order.fulfillments !== undefined && order.fulfillments[0].pickupDetails !== undefined) {
                    (order.fulfillments[0].pickupDetails.note as string) = newOrders[idx]
                }
                
                promiseRa.push((async ()=> {
                    let sqCustId: string;
                    try {
                        let custIdRes = await pgPool.query(`select sqid from customer where id=(select custid from custorders where sqorderid='${order.id}'`);
                        if (custIdRes.rowCount >= 1) {
                            sqCustId = custIdRes.rows[0]["custid"];
                            order.customerId = sqCustId
                        }
                        let updateOrderRequest: Square.UpdateOrderRequest = {
                            idempotencyKey: nanoid(),
                            order
                        }
                        await sqClient.ordersApi.updateOrder(order.id as string, updateOrderRequest)
                    } catch (error) {
                        console.error(`error updating order for sqorderid = ${order.id}: `)
                        console.error(error)
                    }
                    return;
                })())
            })
            return promiseRa;
        })(newSqOrders?.result?.orders as Square.Order[]))




        let squareOrderUrlTemplate = squareUrlPrefix + (process.env.NODE_ENV === "test" || process.env.STAGING === "true"?"sandbox":"") + squareUrlDashboardPrefix
        if (newOrders.length >= 3) {
            let newOrderLinks = Array<string>(newOrders.length);




            newOrders.forEach((order,idx)=>{
                let fullOrderURL = `${squareOrderUrlTemplate}${order}`
                console.error('notifying admin about order: ' + fullOrderURL)
                newOrderLinks[idx] = `<a href="${fullOrderURL}">order id: ${order}</a>`
            })

            await sendemail({
                recipient: notificationEmail,
                sender: 'chair@brooklyn-neighborhood.org',
                subject: "New plaque orders ready for review"
            }, {
                text: "The following orders have come in and await your approval. Please log into the order system and mark them \"in progress\" or \"complete\" as appropriate:  " + newOrders.join("\n"),
                html: `The following orders have come in and await your approval:<br>
                    <ul><li>${newOrderLinks.join('</li><li>')}</li></ul><br>Please log into the order system and move them to 'in progress' or 'completed' as appropriate.
                `
            })
            await pgPool.query(`update custorders set status='t_notified' where status='new' OR status='PROPOSED'`);
        }

    } catch (error) {
        console.error("Error updating Square orders: " + error)
        if (undefined !== error.body) {
            console.error(error.body)
        }
    } 
}

export async function linkSquareOrdersToCustomers() {
    // look for new orders
    let fulfillmentFilterNew: SearchOrdersFulfillmentFilter = {
        fulfillmentStates: ["PROPOSED"]
    }
    let searchOF: SearchOrdersFilter = {
        fulfillmentFilter: fulfillmentFilterNew
    }
    let orderSearchQuery: SearchOrdersQuery = {
        filter: searchOF
    }
    
    let orderSearchRequest: SearchOrdersRequest = {
        query: orderSearchQuery
    }
    orderSearchRequest.locationIds = [process.env.REACT_APP_LOCATION_ID as string]
    try {
        let res = await sqClient.ordersApi.searchOrders(orderSearchRequest)
        res.result.orders
        if (res?.result?.orders?.length !== undefined && res?.result?.orders?.length > 0) {
            await Promise.all(((ra: Array<Square.Order>): Array<Promise<void >> =>{
                let promiseRa = new Array<Promise<void> >(ra.length);
                ra.forEach((order,idx) => {
                    promiseRa.push(   
                        (async (order,idx)=>{
                            try {
                                if (!order.customerId) {
                                    let custid: string;
                                    let custidres = await pgPool.query(`select sqid,sqorderid from customer join custorders on customer.id=custorders.custid where sqorderid='${order.id}'`)
                                    if (custidres.rowCount > 0) {
                                        custid = custidres.rows[0]['sqid'];
                                        let updatedOrder = order;
                                        updatedOrder.customerId = custid;
                                        let sqOrderUpdateRequest: UpdateOrderRequest = {
                                            idempotencyKey: nanoid(),
                                            order: updatedOrder
                                        }
                                        await sqClient.ordersApi.updateOrder(order.id as string, sqOrderUpdateRequest)
                                    }
                                }
                            } catch (error) {
                                console.error(`error updating order ${order.id}`)
                                console.error(error)
                            }
                        })(order,idx))
                })
                return promiseRa
            })(res?.result?.orders as Square.Order[]))
        }
        
    } catch(error) {
        console.error(error)
    } 
}

export async function generateVendorOrder() {
    let emailHdr = {
        recipient: process.env.NOTIFICATION_RECIPIENT || "treasurer@brooklyn-neighborhood.org",
        sender: "chair@brooklyn-neighborhood.org",
        subject: 'New plaque vendor group order',
    };
    let emailBody = {
        text: "",
        html: ""
    }
    let groupOrderCode = nanoid()
    let htmlAsString: string = `<P>The following orders have been paid for by customers and are ready for vendor processing. Please reference group order code ${groupOrderCode} (in check memo lines, etc). <table><caption>Orders ready for vendor processing</caption><th>Order Id (BAC)</th><th>Cust Id (BAC)</th><th>Year</th><th>Custom text</th>`
    try {
        let res = await pgPool.query(`select * from custorders join customer on custorders.custid=customer.id where status='COMPLETED' AND oldstate!='COMPLETED'`)
        if (res.rowCount < 3) {
            throw('Not enough orders for vendor order yet')
        } else {
            await pgPool.query(`update custorders set oldstate='COMPLETED',vendororder='${groupOrderCode}' where oldstate!='COMPLETED' AND status='COMPLETED'`)
        }
        res.rows.forEach((row,idx)=>{
            htmlAsString += formatHtmlVendorOrder(row);
        })
        // await promiseForAll(res.rows,async (row:any,idx:number)=>{
        //     htmlAsString += formatHtmlVendorOrder(row);
        //     let sqorderid=row['sqorderid']
        //     await pgPool.query(`update custorders set vendorder='${groupOrderCode}' where sqorderid='${sqorderid}'`)
        // })
        htmlAsString += '</table>'
        emailBody.html = htmlAsString
        emailBody.text = 'Please see attachments'
        await sendemail(emailHdr,emailBody)
    } catch (error) {
        console.error(error)
    }
} 

function formatHtmlVendorOrder(orderInfo: VendorOrderInfo) {
    let squareCustUrlTemplate = squareUrlPrefix + (process.env.NODE_ENV === "test" || process.env.STAGING === "true"?"sandbox":"") + squareUrlDashboardCustPrefix
    let sqCustLink = squareCustUrlTemplate + orderInfo.sqid
    let sqidLink = `<a href="${sqCustLink}">${orderInfo.sqid}</a>`
    let sqorderidUrlTemplate =  squareUrlPrefix + (process.env.NODE_ENV === "test" || process.env.STAGING === "true"?"sandbox":"") + squareUrlDashboardPrefix
    let sqorderidLink = `<a href="${sqorderidUrlTemplate+orderInfo.sqorderid}">${orderInfo.sqorderid}</a>`
    return `<tr>${sqorderidLink}<td>${sqidLink}</td><td>${orderInfo.year}</td><td>${orderInfo.customwords}</td></tr>`
}

// create promise dot all out of an ra foreach loop
function promiseForAll<T>(ra: Array<T>, cb: (t:T,idx:number)=>Promise<unknown>) {
    return Promise.all(((cbarg:(t:T,idx:number)=>Promise<unknown>)=>{
        let promiseRa = new Array<Promise<unknown > >(ra.length);
        ra.forEach((row,idx)=>{
            promiseRa.push(cbarg(row,idx))
        })
        return promiseRa;
    })(cb));
}
