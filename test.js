// let str = "abcd150asdfb6sfa41asf4" // 201
// let sum = 0;
// let arr = [...str]


// for(let i =0; i< arr.length; i++){
//     if(arr[i].charCodeAt(0) >= 48 && arr[i].charCodeAt(0) <= 57){
//         if(arr[i-1] && arr[i-1].charCodeAt(0) >= 48 && arr[i-1].charCodeAt(0) <= 57){
//             sum += conca
//         }else { // if the previous character is not a number
//             sum += Number(arr[i])
//         }
//     }
// }
// console.log(Number(sum))

// const clear = true;

// const interval = ()=>{

//     const interval = setInterval(() => {
//         console.log('interval');

//         if(clear){
//             clearInterval(interval);
//             console.log('cleared');
//         }
//     }, 1000);
// }

// interval();





if (navigator.geolocation) {
    const tryGetPosition = (options, isRetry = false) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log(position.coords.latitude, position.coords.longitude);
                console.log("lat type: ", typeof position.coords.latitude);
                console.log("lon type: ", typeof position.coords.longitude);
            },
            (error) => {
                if (error.code === 3 && !isRetry) {
                    // Timeout: retry with relaxed options (network/cached location is faster)
                    tryGetPosition({
                        enableHighAccuracy: false,
                        timeout: 15000,
                        maximumAge: 60000
                    }, true);
                    return;
                }
                const msg = `Geolocation error (code ${error.code}): ${error.message}`;
                console.error(msg);
                const userMsg = error.code === 1
                    ? "Location access denied. Please enable location permissions."
                    : error.code === 3
                        ? "Location request timed out. Please try again."
                        : "Unable to get your location. Please enable location access.";
                console.error(userMsg);
            },
            options
        );
    };
    tryGetPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
    });
}