import {Request, Response, NextFunction, RequestHandler} from 'express';
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
const pgClient = new pg.Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
})

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
    console.error(`header digest: ${request.get('X-Square-Signature')}`)
    console.error(`computed hash: ${hash}`)
    console.error(`url: ${NOTIFICATION_URL}`)
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
    next()  
  }
  let fulfillmentUpdateJson = req.body;

  let orderUpdateObj = JSONtoOrderUpdateObj.toOrderUpdateWebhookPayload(fulfillmentUpdateJson)
//TODO: the type here is order.fulfillment.update
//it is "order" only on the fulfillmentUpdateObj
//in any case, there should be a 'next()' either in 
//an else clause or immediately before falling through
//the end
  if (orderUpdateObj?.type === "order") {
    let sqOrderId = orderUpdateObj.data.id
    let fulfillmentUpdateObj = orderUpdateObj.data.object.orderFulfillmentUpdated.fulfillmentUpdate[0]
    let newState = fulfillmentUpdateObj.newState;
    let oldState = fulfillmentUpdateObj.oldState;

    (async function () {
      let arrowFunc = async () => {
        try {
          await pgClient.connect()
          console.warn(`Updating order status for order ${sqOrderId} from ${oldState} to ${newState}`)
          await pgClient.query(`update custorders set status='${newState}' where sqorderid='${sqOrderId}'`)
          next()
        } catch (error) {
          console.error(`Error updating local db with order fulfillment change on order ${sqOrderId}: `)
          console.error(error)
          next(error)
        } finally {
          pgClient.end()
        }
      }
      await arrowFunc();
    }
    )();
  }
}
