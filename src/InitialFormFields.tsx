import {TextField,Dialog} from '@material-ui/core'
import {OverpassResponse,OverpassJson,overpass,} from 'overpass-ts'
import { useState, useEffect } from 'react';
import { NewPaymentForm } from './NewPaymentForm';
import {fmtAddressQueryResults} from './overpass-utils'


export function InitialFormFields(props: {
}) {
    const [address, setAddress] = useState('')
    const [addressNotFound,setAddressNotFound] = useState(true)
    const [overpassErrorMsg,setOverpassErrorMsg] = useState("")
    const [addressValidated,setAddressValidated] = useState(false)

    function openPaymentDialog() {
        return addressValidated;
    }

    useEffect(()=>{
        (document.getElementById('addr-value') as HTMLInputElement).value = address;
        if (addressValidated) {
        }
    },[address,addressValidated,overpassErrorMsg]
    )

    async function verifyAddress() {
        let addr = (document.getElementById('addr-value') as HTMLInputElement).value;
        let addrregex = /^([0-9]+)\s+(?:(?:SE)|(?:Southeast))\s+([^\s]+).*/i;
  
        let parsedAddress = addr.match(addrregex);
        if (parsedAddress !== null && parsedAddress.length === 3) {
          var houseNumber = parsedAddress[1];
          var streetName = parsedAddress[2];
          let addressNotFound = document.getElementById('address-not-found');
          let overpassError = document.getElementById('overpass-error');
          let pymtForm = document.getElementById('plaque-payment-form')
          try {
            let res = await overpass(
              `[out:json][timeout:120][bbox:45.48965204000928,-122.66239643096925,45.50168487047437,-122.63664722442628];
            nwr["addr:housenumber"="${houseNumber}"]["addr:street"~"${streetName}"];
            out body;`, {endpoint: "https://overpass.kumi.systems/api/interpreter"}) as OverpassJson
            setAddress(fmtAddressQueryResults(res))
            setAddressValidated(true)
          } catch (error) {
            console.error(error?.message);
            if (null !== pymtForm){
              pymtForm.style.visibility = "hidden";
            }
            setOverpassErrorMsg(error?.message);
          }
        }
      }
  

    return (
        <div id='initial-form-fields'>
            <Dialog open={openPaymentDialog()}>
                <NewPaymentForm></NewPaymentForm>
            </Dialog>

            <h3 id="plaque-request-header">I want to order an historic plaque for:</h3>

            <form id="address-form">
                <div className="float-container">

                    <div className="float-child-left">
                        <div className="green">

                            <TextField
                                id="addr-value"
                                value={address}
                                label="Historic home street address"
                                variant="filled"
                                helperText="Required">
                            </TextField>
                        </div>
                    </div>

                    <div className="float-child-right">
                        <TextField id="plaque-year" label="Year built" variant="filled" inputProps={{ maxLength: 4 }} style={{ width: 100 }}></TextField>
                        <TextField id="plaque-optional-text" label="Brief optional text" variant="filled"></TextField>


                    </div>

                </div>
                <button id="verify-address" type="button" onClick={verifyAddress}>Verify</button>
                <br></br>
            </form>
        </div>
    )
}