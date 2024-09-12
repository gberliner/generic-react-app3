import {Request, Response, NextFunction, RequestHandler, response} from 'express';
import {Convert as JSONtoOrderUpdateObj} from './orderUpdateWebhookPayload'
import {createHmac} from 'crypto'
import pg from 'pg';
/* example json payload 
{
    "merchant_id": "5S9MXCS9Y99KK",
    "type": "order.fulfillment.updated",
    "event_id": "b3adf364-4937-436e-a833-49c72b4baee8",
    "created_at": "2020-04-16T23:16:30.789Z",
    "data": {
      "type": "order",
      "id": "eA3vssLHKJrv9H0IdJCM3gNqfdcZY",
      "object": {
        "order_fulfillment_updated": {
          "created_at": "2020-04-16T23:14:26.129Z",
          "fulfillment_update": [
            {
              "fulfillment_uid": "VWJ1N9leLqjSDLvF2hvYjD",
              "new_state": "RESERVED",
              "old_state": "PROPOSED"
            }
          ],
          "location_id": "FPYCBCHYMXFK1",
          "order_id": "eA3vssLHKJrv9H0IdJCM3gNqfdcZY",
          "state": "OPEN",
          "updated_at": "2020-04-16T23:16:30.789Z",
          "version": 6
        }
      }
    }
  } */

const NOTIFICATION_URL = 'https://dementia-praecox.herokuapp.com/api/order-fulfillment-updated';

const connectionString = process.env.DATABASE_URL
const pool = new pg.Pool(
  {
    connectionString
  }
)

function isFromSquare(request: Request, sigKey: string, readFromHeaders=false) {
  const hmac = createHmac('sha1', sigKey);
  let url = NOTIFICATION_URL; 
  let requestHostname = request.headers.host;
  if (process.env.NODE_ENV === "test") {
    requestHostname = request.get('X-Forwarded-For')??requestHostname;
  }
  if (readFromHeaders) {
    url = request.protocol + "://" + requestHostname + "/api/order-fulfillment-updated"
  }
  
  hmac.update(url + (request.body as string));
  const hash = hmac.digest('base64');
  let retval = request.get('X-Square-Signature') === hash;
  if (!retval) {
    console.error(`authorization to webhook endpoint failed: site ${url}`)
    console.error(`request body: ${request.body}`);
    console.error(`sig: ${process.env.ORDERUPDATE_WEBHOOK_SIGKEY}`)
    console.error(`content-length ${request.get('Content-Length')}`)
    console.error(`header digest: ${request.get('X-Square-Signature')}`)
    console.error(`computed hash: ${hash}`)
    console.error(`url: ${url}`)
  }
  return retval
}

export function handleOrderFulfillmentUpdate(req: Request, res: Response, next: NextFunction) {
  // verify legit request
  //TODO: add this config var!:
  let readHostFromHeaders = true;
  if (!!process.env.READ_HOST_FROM_HEADERS && process.env.READ_HOST_FROM_HEADERS === "true") {
    readHostFromHeaders = true;
  }

  if (!isFromSquare(req, process.env.ORDERUPDATE_WEBHOOK_SIGKEY as string, readHostFromHeaders)) {
    console.error("unauthorized request origin, not originating from square!")
    res.json({error: "unauthorized request source"})  
  } else {
    let fulfillmentUpdateJson = req.body;
    process.env.DEBUG==="true" && console.error("reading fulfillment notification from square endpoint")
    process.env.DEBUG==="true" && console.error(`payload was: ${fulfillmentUpdateJson}`)
    let orderUpdateObj = JSONtoOrderUpdateObj.toOrderUpdateWebhookPayload(fulfillmentUpdateJson)
    let {data:{id,object:{orderFulfillmentUpdated:{fulfillmentUpdate:[{oldState,newState}]}}}}=orderUpdateObj;
    let sqOrderId = id;
  
    (async function () {
      let arrowFunc = async () => {
        try {
          console.warn(`Updating order status for order ${sqOrderId} from ${oldState} to ${newState}`)
          await pool.query(`update custorders set status='${newState}',oldstate='${oldState}' where sqorderid='${sqOrderId}'`)
          res.json({"result":"success"})
        } catch (error) {
          console.error(`Error updating local db with order fulfillment change on order ${sqOrderId}: `)
          console.error(error)
          res.json({"error": error.message})
        }
      }
      await arrowFunc();
    }
    )();
  }
}

