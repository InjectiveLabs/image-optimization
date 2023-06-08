const AWS = require('aws-sdk');
const https = require('https');
const fetch = require('node-fetch');

const S3 = new AWS.S3({signatureVersion: 'v4',httpOptions: {agent: new https.Agent({keepAlive: true})}});
const S3_IMAGES_BUCKET = process.env.imagesBucket;
const S3_IMAGE_CACHE_TTL = process.env.imageCacheTTL;
const SECRET_KEY = process.env.secretKey;

exports.handler = async (event) => {
    // First validate if the request is coming from CloudFront
    if (!event.headers['x-origin-secret-header'] || !(event.headers['x-origin-secret-header'] === SECRET_KEY)) return sendError(403, 'Request unauthorized', event);
    // Validate if this is a GET request
    if (!event.requestContext || !event.requestContext.http || !(event.requestContext.http.method === 'GET')) return sendError(400, 'Only GET method is supported', event);
    // An example of expected path is /validator/foo/30E6CD38D9721222 or /validator/bar/30E6CD38D9321222
    var imagePathArray= event.requestContext.http.path.split('/');
    // get the keybase ID
    var keybaseID = imagePathArray.pop()
    // get path /validator/foo
    var originalImagePath = imagePathArray.join('/');
    // timing variable
    // Downloading original image
    let contentType;
    let imageData;
    let base64ImageData;
    try {
        // get from keybase: https://keybase.io/_/api/1.0/user/lookup.json?fields=pictures&key_suffix=30E6CD38D9721222
        /* {"status":{"code":0,"name":"OK"},"them":[{"id":"8238ee1ab2b7509087bfe1a0ea86c819","pictures":{"primary":{"url":"https://s3.amazonaws.com/keybase_processed_uploads/c9fbb1676edede4bf0b3c787aefaa205_360_360.jpg","source":null}}}]} */
        const response = await fetch("https://keybase.io/_/api/1.0/user/lookup.json?fields=pictures&key_suffix="+keybaseID);
        const jsonData = await response.json();

        let keybaseImageURL = jsonData["them"][0]["pictures"]["primary"]["url"]
        if (keybaseImageURL === "" || keybaseImageURL === undefined) {
            throw new Error("no primary picture URL detected")
        }

        const imageResponse = await fetch(keybaseImageURL);

        contentType = imageResponse.headers.get("Content-Type")
        imageData = await imageResponse.buffer()
        base64ImageData = imageData.toString('base64')

    } catch (error) {
        return sendError(500, 'error downloading original image', error);
    }

    // upload transformed image back to S3 if required in the architecture
//    try {
//        await S3.putObject({
//            Body: imageData,
//            Bucket: S3_IMAGES_BUCKET,
//            Key:  originalImagePath + keybaseID,
//            ContentType: contentType,
//            Metadata: {
//                'cache-control': S3_IMAGE_CACHE_TTL,
//            },
//        }, function(err, data) {}).promise();
//    } catch (error) {
//        sendError('APPLICATION ERROR', 'Could not upload transformed image to S3', error);
//    }

    // return image
    return {
        statusCode: 200,
        body: base64ImageData,
        isBase64Encoded: true,
        headers: {
            'Content-Type': contentType, 
            'Cache-Control': S3_IMAGE_CACHE_TTL
        }
    };
};

function sendError(code, message, error){
    console.log('APPLICATION ERROR', message);
    console.log(error);
    return {
        statusCode: code,
        body: message + error,
    };
}
