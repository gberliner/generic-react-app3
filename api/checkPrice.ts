import pg from 'pg'
import { NextFunction, Request,Response, RequestHandler }  from 'express'

import {ExpressHandler} from '../interfaces/handlers'
import Square, {CatalogApi,OrdersApi} from 'square';
import { nextTick } from 'process';
type Req = {

}
type Res = {
    status: Number;
    error?: string;
    price?: number;
}
//export default void function paymentRcvd  (req: Request,res: Response) : ExpressHandler<Request,Response> {        
export default function checkPrice(req: Request, res: Response, next: NextFunction): RequestHandler<Request,Response,NextFunction> {
    let connectionString = process.env.DATABASE_URL;
    let productName = "Regular Plaque"
    let pgClient = new pg.Client({
        connectionString
    });
    pgClient.connect();
    pgClient.query(`select price from salescatalog where name='${productName}'`).then(
        async (resultSet) => {
            let locallyAvailable = true;
            let price_money: BigInt|undefined;
            let plaqueCatalogId: string|undefined;
            if (resultSet.rowCount >= 1) {
                // Good: we already have the results in the local db
                let price_report_number = resultSet.rows[0].price/100.;
                console.log("Read catalog item price from local db");
                res.json({status: 200, price: price_report_number});
            } else {
                locallyAvailable = false;
                // Reach out to Square, then cache our results locally
                let sqClient = new Square.Client(
       
                    {
                        environment: (process.env.NODE_ENV === "production" && process.env.STAGING !== "true")?Square.Environment.Production:Square.Environment.Sandbox,
                        accessToken: process.env.SQUARE_ACCESS_TOKEN,
                        
                    }
                );
                let currentId: string
                let capi = new CatalogApi(sqClient);
                try {
                    const {result,...httpResponse} = await capi.listCatalog("","ITEM_VARIATION");
                    let r = result;

                    if (httpResponse.statusCode !== 200) {
                        console.error("http response status: error " + httpResponse.statusCode)
                        let error = new Error("unexpected result from catalogapi.listCatalog: " + JSON.stringify(httpResponse.body))
                        next(error);                        
                    } else {
                        let item: Square.CatalogObject|undefined;
                        do {
                            item = r?.objects?.pop()
                            if (item?.itemVariationData?.name === productName) {
                                // @ts-ignore
                                plaqueCatalogId = item?.id
                                // @ts-ignore
                                price_money = item?.itemVariationData?.priceMoney?.amount;
                                break
                            }
                        } while (item !== null)
                        //Report back our results
                        let price_number = Number(price_money)/100.0;
                        let price_report = price_number.toString();
                        let price_report_db = Number(price_money).toString();
                        let price_report_number = parseInt(price_report);
                        res.json({status: 200, price: (price_report_number)});

                        //Now we cache the results locally
                        let catalog_update_query: string;
                        if (undefined !== plaqueCatalogId) {
                            catalog_update_query = `insert into salescatalog (objectid,name,price) values ('${plaqueCatalogId}','${productName}',${price_report_db})`;
                            console.log("making catalog update: " + catalog_update_query);
                            pgClient.query(catalog_update_query).then(onFulfilled => {
                                console.log("catalog entry saved to database: " + catalog_update_query)
                            }).catch(
                                (error) => {
                                    console.error(error.message)
                                    next(error)
                                }
                            )
                        }
                    }
                    if (price_money === undefined) {
                        let err = new Error("Couldn't find standard catalog item price");
                        console.error(err.message)
                        next(err)
                    } else {                        
                        console.log(`Ùpdated database with current price info`);
                    }
                } catch(error) {
                    console.error(error.message)
                    next(error)
                }

        }}).catch((error)=>{
            console.error(error.message)
            next(error)
        }).finally(()=>{
            pgClient.end();
        });
    return((void(null) as unknown) as RequestHandler<Request,Response>);

} 

    
export {checkPrice}
