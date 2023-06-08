## Image Optimization

## Deploy the solution using CDK
AWS CDK is an open-source software development framework used to define cloud infrastructure in code and provision it through AWS CloudFormation. Follow these steps in your command line to deploy the image optimization solution with CDK, using the region and account information configured in your AWS CLI.

```
git clone https://github.com/aws-samples/image-optimization.git 
cd image-optimization
npm install
cdk bootstrap
npm run build
cdk deploy
```

When the deployment is completed within minutes, the CDK output will include the domain name of the CloudFront distribution created for image optimization (ImageDeliveryDomain =YOURDISTRIBUTION.cloudfront.net). The stack will include an S3 bucket with sample images (OriginalImagesS3Bucket = YourS3BucketWithOriginalImagesGeneratedName). To verify that it is working properly, test the following optimized image URL https:// YOURDISTRIBUTION.cloudfront.net/images/rio/1.jpeg?format=auto&width=300.

Note that when deploying in production, it’s recommended to use an existing S3 bucket where your images are stored. To do that, deploy the stack in the same region of your S3 bucket, using the following parameter: cdk deploy -c S3_IMAGE_BUCKET_NAME=’YOUR_S3_BUCKET_NAME’. The solution allows you to configure other parameters such as whether you want to store transformed images in S3 (STORE_TRANSFORMED_IMAGES), the duration after which transformed images are automatically removed from S3 (S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION), and the Cache-Control header used with transformed images (S3_TRANSFORMED_IMAGE_CACHE_TTL).

## Clean up resources

To remove cloud resources created for this solution, just execute the following command:

```
cdk destroy
```

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

