import {Request, Response, NextFunction, RequestHandler, response} from 'express';
import {Convert as JSONtoCatalogUpdateObj} from './catalogUpdateWebhookPayload'
import {createHmac} from 'crypto'
import pg from 'pg';
/*
Webhook notification data is packaged as 
"catalog_version": { "updated_at": "2019-05-14T17:51:27Z"}.
*/

const NOTIFICATION_URL = 'https://dementia-praecox.herokuapp.com/api/catalog-version-updated';

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
    url = request.protocol + "://" + requestHostname + "/api/catalog-version-updated"
  }
  
  hmac.update(url + (request.body as string));
  const hash = hmac.digest('base64');
  let retval = request.get('X-Square-Signature') === hash;
  if (!retval) {
    console.error(`authorization to webhook endpoint failed: site ${url}`)
    console.error(`request body: ${request.body}`);
    console.error(`sig: ${process.env.CATALOGUPDATE_WEBHOOK_SIGKEY}`)
    console.error(`content-length ${request.get('Content-Length')}`)
    console.error(`header digest: ${request.get('X-Square-Signature')}`)
    console.error(`computed hash: ${hash}`)
    console.error(`url: ${url}`)
  }
  return retval
}

export function handleCatalogVersionUpdate(req: Request, res: Response, next: NextFunction) {
  // verify legit request
  //TODO: add this config var!:
  let readHostFromHeaders = true;
  if (!!process.env.READ_HOST_FROM_HEADERS && process.env.READ_HOST_FROM_HEADERS === "true") {
    readHostFromHeaders = true;
  }

  if (!isFromSquare(req, process.env.CATALOGUPDATE_WEBHOOK_SIGKEY as string, readHostFromHeaders)) {
    console.error("unauthorized request origin, not originating from square!")
    res.json({error: "unauthorized request source"})  
  } else {
    let catalogUpdateJson = req.body;
    process.env.DEBUG==="true" && console.error("reading catalog update notification from square endpoint")
    process.env.DEBUG==="true" && console.error(`payload was: ${catalogUpdateJson}`)
    let catalogUpdateObj = JSONtoCatalogUpdateObj.toCatalogVersionUpdate(catalogUpdateJson)
    
    let {data:{object:{catalogVersion:{updatedAt}}}} = catalogUpdateObj;
    
    (async function () {
      let arrowFunc = async () => {
        try {
          console.warn(`Refreshing local salescatalog, updated at ${updatedAt}`)
          await pool.query(`delete from salescatalog`)
          res.json({"result":"success"})
        } catch (error) {
          console.error(`Error refreshing local salescatalog: `)
          console.error(error)
          res.json({"error": error.message})
        }
      }
      await arrowFunc();
    }
    )();
  }
}

