import Square, {OrdersApi} from 'square';
import {Request, Response, NextFunction, RequestHandler} from 'express';
import pg from 'pg';
import {ExpressHandler} from '../interfaces/handlers'
import {nanoid} from 'nanoid';
import {jsonParseIfStringified} from '../api/stringUtils'
//at present, there is only one catalog item:
//{"objects":[{"type":"ITEM","id":"TVDFRE4NN4LQEYVIUFAZ3L4Y","updated_at":"2021-07-14T22:33:28.797Z","version":1626302008797,"is_deleted":false,"present_at_all_locations":true,"image_id":"NIUGWP325MGF25ADAKBKO7Y7","item_data":{"name":"standard plaque","description":"Brooklyn neighborhood historic plaque, standard size and design ","visibility":"PRIVATE","variations":[{"type":"ITEM_VARIATION","id":"Y3IROCVXXXKS4G6RNFKKFKZV","updated_at":"2021-07-14T22:33:28.797Z","version":1626302008797,"is_deleted":false,"present_at_all_locations":true,"item_variation_data":{"item_id":"TVDFRE4NN4LQEYVIUFAZ3L4Y","name":"Regular","sku":"0000100","ordinal":1,"pricing_type":"FIXED_PRICING","price_money":{"amount":3000,"currency":"USD"},"stockable":true}}],"product_type":"REGULAR","skip_modifier_screen":true,"ecom_visibility":"UNINDEXED"}}]}
type Req = {
    nonce: string,
    buyerVerificationToken: string|undefined,
    email: string;
    phone: string;
    address: string;
    year: string;
    customwords: string;
    firstname: string;
    lastname: string;
}
type Res = {
    status?: Number;
    error?: string;
    orderid?: string;
}

export default function createPlaqueOrder(req:Request, res:Response, next:NextFunction): RequestHandler<Request,Response,NextFunction>  {
    let plaqueCatalogId: string;
    let base_price_money: Square.Money  = {
        amount: BigInt(9999),
        currency: 'USD'
    };
    let catalogItemName = "Regular Plaque"
    let pgClient = new pg.Client({
        connectionString: process.env.DATABASE_URL
    })
    
    let reqData: Req = req.body;
    let email = reqData?.email;
    let phone = reqData?.phone;
    let address = reqData?.address;
    let year = reqData?.year;
    let customwords = reqData?.customwords;
    let firstname = reqData?.firstname;
    let lastname = reqData?.lastname;
    let clientEnvironmentSandbox = {
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: Square.Environment.Sandbox,
        customUrl: "https://connect.squareupsandbox.com"
    }
    let clientEnvironmentProduction = {
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: Square.Environment.Production
    }
    let clientEnvironment;
    clientEnvironment = clientEnvironmentSandbox;
 
    if (process.env.NODE_ENV === "production") {
        clientEnvironment = clientEnvironmentProduction;
    }
    if (process.env?.STAGING === "true") {
        clientEnvironment = clientEnvironmentSandbox;
    }
    let client = new Square.Client(clientEnvironment);
    console.error(`using token ${process.env.SQUARE_ACCESS_TOKEN}, staging: ${process.env.STAGING}`);
    pgClient.connect();
    pgClient.query(`select ObjectId,price from SalesCatalog where name='${catalogItemName}'`).then(
        async (rset) => {
            if (rset.rowCount >= 1) {
                plaqueCatalogId =rset.rows[0]?.objectid;
                let intprice = rset.rows[0]?.price
                base_price_money.amount = BigInt(intprice)
                base_price_money.currency = 'USD'
            
                const bodyOrderLineItems: Square.OrderLineItem[] = [];
    
    
    
                const bodyOrderlineItems0: Square.OrderLineItem = {
                    quantity: '1',
                };
                bodyOrderlineItems0.basePriceMoney = base_price_money;
                bodyOrderlineItems0.catalogObjectId = plaqueCatalogId;
                bodyOrderLineItems[0] = bodyOrderlineItems0;
                const bodyOrder: Square.Order = {
                    locationId: (process.env.LOCATION_ID===undefined?"undefined":process.env.LOCATION_ID),
                };
                bodyOrder.lineItems = bodyOrderLineItems
                
                let fulfillment: Square.OrderFulfillment;
                let pickupDetails: Square.OrderFulfillmentPickupDetails;
                pickupDetails = {
                    recipient: {
                        displayName: jsonParseIfStringified(email)
                    },
                    autoCompleteDuration: "P4W",
                    scheduleType: "ASAP",
                    note: "year built: " + year + "; " + "optional text: " + customwords,
                    prepTimeDuration: "P4W"
                }
                fulfillment = {
                    uid: nanoid(),
                    state: "PROPOSED",
                    type: "PICKUP",
                    metadata: {
                        "key": "value"
                    },
                    pickupDetails
                }
                Square.OrdersApi  
                let fulfillments: Square.OrderFulfillment[] = new Array(0)
                fulfillments.push(fulfillment)
                const body: Square.CreateOrderRequest = {};
                body.order = bodyOrder
                body.order.fulfillments = fulfillments
                body.idempotencyKey = nanoid();

                let ordersApi = new OrdersApi(client);
                try {
                    const {result, ...httpResponse} = await ordersApi.createOrder(body)
                    const {statusCode,headers} = httpResponse;
                    //body.order.id
                    let sqNewOrderId: string|undefined;
                    if (statusCode !== 200) {
                        console.error('bad http response status: ' + statusCode)
                        next(`bad http response status calling ordersApi: {statusCode} ` + result?.errors?.join(" ")??"no further details available")
                    } else {
                        sqNewOrderId = result?.order?.id
                        if (undefined === sqNewOrderId) {
                            next("apparent glitch in square orderapi: no new orderid returned")
                        }
                        try {
                            await pgClient.query(`insert into CustOrders(SqOrderId,CustEmail,Phone,CustAddr,Year,CustomWords,Status) values (${dollarQuote(sqNewOrderId)},${dollarQuote(email)},${dollarQuote(phone)},${dollarQuote(address)},'${year}',${dollarQuote(customwords)},'new')`);
                            req.body["orderid"] = sqNewOrderId;
                            req.body["price"] = base_price_money.amount.toString();
                            let custqueryres = await pgClient.query(`select * from customer where email='${email}'`)
                            if (1 > custqueryres.rowCount) {
                                await pgClient.query(`insert into customer (firstname,lastname,email,address,phone) values(${dollarQuote(firstname)}, ${dollarQuote(lastname)}, ${dollarQuote(email)},${dollarQuote(address)},${dollarQuote(phone)})`) 
                            }
                            // join custorders and customer on custorders.custid=customer.id
                            let newCustRes = await pgClient.query(`update custorders set custid=(select id from customer where customer.email=${dollarQuote(email)}) where custorders.custemail=${dollarQuote(email)}`)
                            if (newCustRes.rowCount < 1) {
                                console.error(`failed adding foreign custid key to custorders for email address ${email}`)
                            } 
                        } catch (error) {
                            console.error(error?.message)
                            next("Failed to update table CustOrders: " + error?.message??" no further details available")
                        }
                        next()
                    }
    
                    // Done creating Square order  
    

                } catch (error) {
                    if (undefined !== error.body) {
                        console.error(error.body);
                    }
                    next(`call to Square::createOrder failed: ${error.message}`)
                }
         } else {
                next("failed to retrieve catalog item price")
            }        
        }
    ).catch((error) => {
        next(error)
    }
    ).finally(() => {
        pgClient.end()
    }
    );
    return((void(null) as unknown) as RequestHandler<Request,Response,NextFunction>);
}

function dollarQuote(arg:string|undefined){
    let dquote = '$quote$'
    return dquote + arg + dquote
}
export {createPlaqueOrder}
