#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {ValidatorImageStack} from "../lib/validator-image-stack";

const app = new cdk.App();
new ValidatorImageStack(app, 'ValidatorImageStack', {

});

