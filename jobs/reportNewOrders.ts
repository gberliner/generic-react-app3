import { parentPort } from 'node:worker_threads';
import process from 'node:process';
import {reportNewOrders} from '../worker'

import pg from 'pg';
import Square, {CatalogApi,OrdersApi,CustomersApi   } from 'square';
import {nanoid} from 'nanoid';
import {sendemail,EmailBody,EmailHeader} from '../sendemail'
import {UpdateOrderRequest} from 'square/dist/models/updateOrderRequest'
import {SearchOrdersRequest } from 'square/dist/models/searchOrdersRequest';
import { SearchOrdersQuery } from 'square/dist/models/searchOrdersQuery';
import { SearchOrdersFilter } from 'square/dist/models/searchOrdersFilter';
import { SearchOrdersFulfillmentFilter } from 'square/dist/models/searchOrdersFulfillmentFilter';
/// <reference path="types/legit/legit.d.ts" />
import legit from 'legit'
import {jsonParseIfStringified} from '../api/stringUtils'
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

await reportNewOrders();

// signal to parent that the job is done
if (parentPort) parentPort.postMessage('done');
// eslint-disable-next-line unicorn/no-process-exit
else process.exit(0);
