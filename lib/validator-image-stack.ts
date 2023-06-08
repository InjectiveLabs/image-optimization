// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, RemovalPolicy, aws_s3 as s3, aws_s3_deployment as s3deploy, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_lambda as lambda, aws_iam as iam, Duration, CfnOutput, aws_logs as logs} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MyCustomResource } from './my-custom-resource';
import { createHash } from 'crypto';

// Region to Origin Shield mapping based on latency. to be updated when new Regional Edge Caches are added to CloudFront.
const ORIGIN_SHIELD_MAPPING = new Map([['af-south-1', 'eu-west-2'], [ 'ap-east-1' ,'ap-northeast-2'], [ 'ap-northeast-1', 'ap-northeast-1'], [
  'ap-northeast-2', 'ap-northeast-2'], [ 'ap-northeast-3', 'ap-northeast-1'], [ 'ap-south-1', 'ap-south-1'], [ 'ap-southeast-1','ap-southeast-1'], [ 
  'ap-southeast-2', 'ap-southeast-2'], [ 'ca-central-1', 'us-east-1'], [ 'eu-central-1', 'eu-central-1'], [ 'eu-north-1','eu-central-1'], [
  'eu-south-1','eu-central-1'], [ 'eu-west-1', 'eu-west-1'], [ 'eu-west-2', 'eu-west-2'], [ 'eu-west-3', 'eu-west-2'], [ 'me-south-1', 'ap-south-1'], [
  'sa-east-1', 'sa-east-1'], [ 'us-east-1', 'us-east-1'], [ 'us-east-2','us-east-2'], [ 'us-west-1', 'us-west-1'], [ 'us-west-2', 'us-west-2']] );

// Stack Parameters

var S3_IMAGES_BUCKET = 'helixapp-validator-images';
// CloudFront parameters
var CLOUDFRONT_ORIGIN_SHIELD_REGION = ORIGIN_SHIELD_MAPPING.get(process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1');
var CLOUDFRONT_CORS_ENABLED = 'true';

var S3_IMAGE_EXPIRATION_DURATION = '90';
var S3_IMAGE_CACHE_TTL = 'max-age=31622400';
// Lambda Parameters
var LAMBDA_MEMORY = '1500';
var LAMBDA_TIMEOUT = '15';
var LOG_TIMING = 'false';

type ImageDeliveryCacheBehaviorConfig = {
  origin: any;
  viewerProtocolPolicy: any;
  cachePolicy: any;
  functionAssociations: any;
  responseHeadersPolicy?:any;
};

type LambdaEnv = {
  imagesBucket: string,
  imageCacheTTL: string,
  secretKey: string,
}

export class ValidatorImageStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Change stack parameters based on provided context
    S3_IMAGE_EXPIRATION_DURATION = this.node.tryGetContext('S3_IMAGE_EXPIRATION_DURATION') || S3_IMAGE_EXPIRATION_DURATION;
    S3_IMAGE_CACHE_TTL = this.node.tryGetContext('S3_IMAGE_CACHE_TTL') || S3_IMAGE_CACHE_TTL;
    S3_IMAGES_BUCKET = this.node.tryGetContext('S3_IMAGES_BUCKET') || S3_IMAGES_BUCKET;
    CLOUDFRONT_ORIGIN_SHIELD_REGION = this.node.tryGetContext('CLOUDFRONT_ORIGIN_SHIELD_REGION') || CLOUDFRONT_ORIGIN_SHIELD_REGION;
    CLOUDFRONT_CORS_ENABLED = this.node.tryGetContext('CLOUDFRONT_CORS_ENABLED') || CLOUDFRONT_CORS_ENABLED;
    LAMBDA_MEMORY = this.node.tryGetContext('LAMBDA_MEMORY') || LAMBDA_MEMORY;
    LAMBDA_TIMEOUT = this.node.tryGetContext('LAMBDA_TIMEOUT') || LAMBDA_TIMEOUT;
    LOG_TIMING = this.node.tryGetContext('LOG_TIMING') || LOG_TIMING;

    // Create secret key to be used between CloudFront and Lambda URL for access control
    const SECRET_KEY = createHash('md5').update(this.node.addr).digest('hex') ;

    // For the bucket having original images, either use an external one, or create one with some samples photos.
    var imageBucket;

    // create bucket for transformed images if enabled in the architecture

    imageBucket = new s3.Bucket(this, 'helixapp-validator-images', {
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: false, //TODO Hilari lamdba deploy fails
        lifecycleRules: [
            {
              expiration: Duration.days(parseInt(S3_IMAGE_EXPIRATION_DURATION)),
            },
          ],
      });


    // prepare env variable for Lambda 
    var lambdaEnv: LambdaEnv = {
      imagesBucket: imageBucket.bucketName,
      imageCacheTTL: S3_IMAGE_CACHE_TTL,
      secretKey: SECRET_KEY,
    };

    // IAM policy to read from the S3 bucket containing the original images
    const s3ReadOriginalImagesPolicy = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: ['arn:aws:s3:::'+imageBucket.bucketName+'/*'],
    });

    // statements of the IAM policy to attach to Lambda
    var iamPolicyStatements = [s3ReadOriginalImagesPolicy];

    // Create Lambda for image processing
    var lambdaProps = {
      runtime: lambda.Runtime.NODEJS_16_X, 
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/validator-image'),
      timeout: Duration.seconds(parseInt(LAMBDA_TIMEOUT)),
      memorySize: parseInt(LAMBDA_MEMORY),
      environment: lambdaEnv,
      logRetention: logs.RetentionDays.ONE_DAY,
    };
    var imageDownloadLambda = new lambda.Function(this, 'download-keybase-image', lambdaProps);

    // Enable Lambda URL
    const imageProcessingURL = imageDownloadLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Leverage a custom resource to get the hostname of the LambdaURL
    const imageProcessingHelper = new MyCustomResource(this, 'customResource', {
      Url: imageProcessingURL.url
    });

    // Create a CloudFront origin: S3 with fallback to Lambda when image needs to be transformed, otherwise with Lambda as sole origin
    var imageOrigin;

      imageOrigin = new origins.OriginGroup ({
        primaryOrigin: new origins.S3Origin(imageBucket, {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
        }),
        fallbackOrigin: new origins.HttpOrigin(imageProcessingHelper.hostname, {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
          customHeaders: {
            'x-origin-secret-header': SECRET_KEY,
          },
        }), 
        fallbackStatusCodes: [403],
      });

      // write policy for Lambda on the s3 bucket for transformed images
      var s3WriteTransformedImagesPolicy = new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: ['arn:aws:s3:::'+imageBucket.bucketName+'/*'],
      });
      iamPolicyStatements.push(s3WriteTransformedImagesPolicy);

    // attach iam policy to the role assumed by Lambda
    imageDownloadLambda.role?.attachInlinePolicy(
      new iam.Policy(this, 'read-write-bucket-policy', {
        statements: iamPolicyStatements,
      }),
    );

    var imageDeliveryCacheBehaviorConfig:ImageDeliveryCacheBehaviorConfig  = {
      origin: imageOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
        defaultTtl: Duration.hours(24),
        maxTtl: Duration.days(365),
        minTtl: Duration.seconds(0),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all()
      }),
      functionAssociations: [],
    }

    if (CLOUDFRONT_CORS_ENABLED === 'true') {
      // Creating a custom response headers policy. CORS allowed for all origins.
      const imageResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, `ResponseHeadersPolicy${this.node.addr}`, {
        responseHeadersPolicyName: 'ImageResponsePolicy',
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: ['*'],
          accessControlAllowMethods: ['GET'],
          accessControlAllowOrigins: ['*'],
          accessControlMaxAge: Duration.seconds(600),
          originOverride: false,
        },
        // recognizing image requests that were processed by this solution
        customHeadersBehavior: {
          customHeaders: [
            { header: 'x-aws-download-image', value: 'v1.0', override: true },
            { header: 'vary', value: 'accept', override: true },
          ],
        }
      });
      imageDeliveryCacheBehaviorConfig.responseHeadersPolicy = imageResponseHeadersPolicy;
    }
    const imageDelivery = new cloudfront.Distribution(this, 'imageValidatorDownloadDistribution', {
      comment: 'validator image download and delivery',
      defaultBehavior: imageDeliveryCacheBehaviorConfig
    });

    new CfnOutput(this, 'ValidatorDownloadImageDeliveryDomain', {
      description: 'Domain name of validator download image delivery',
      value: imageDelivery.distributionDomainName
    });
  }
}
