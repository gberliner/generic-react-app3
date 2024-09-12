import pg from 'pg'
const connectionString = process.env.DATABASE_URL;

(async function doQuery() {
    let pgClient = await new pg.Client({
        connectionString
    });
    let res = await pgClient.query('select * from custorder as o join customer as c on o.custemail=c.email')
    res.rows.forEach((row)=>{
        console.log(`email = ${row['o.custemail']}`)
    })
})()
