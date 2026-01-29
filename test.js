let str = "abcd150asdfb6sfa41asf4" // 201
let sum = 0;
let arr = [...str]


for(let i =0; i< arr.length; i++){
    if(arr[i].charCodeAt(0) >= 48 && arr[i].charCodeAt(0) <= 57){
        if(arr[i-1] && arr[i-1].charCodeAt(0) >= 48 && arr[i-1].charCodeAt(0) <= 57){
            sum += conca
        }else { // if the previous character is not a number
            sum += Number(arr[i])
        }
    }
}
console.log(Number(sum))