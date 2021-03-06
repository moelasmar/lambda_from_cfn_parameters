import * as cdk from 'aws-cdk-lib';
import * as cxapi from 'aws-cdk-lib/cx-api';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct, Node } from 'constructs';
import * as path from 'path';

export class CDKSupportDemoRootStack extends cdk.Stack {
  constructor(app: Construct, id: string, props?: cdk.StackProps) {
    super(app, id, props);

    const localCodePath = path.resolve(__dirname, '../src/LambdaFunc') ;
    const lambdaFunctionCodeProperty = 'Code';

    const lambdaStack = new cdk.Stack(app, 'LambdaStack');
    const lambdaCode = lambda.Code.fromCfnParameters();
    const lambdaFunction = new lambda.Function(lambdaStack, 'Lambda', {
      code: lambdaCode,
      handler: 'app.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_7,
    });

    const child = Node.of(lambdaFunction).defaultChild as CfnFunction;
    child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PATH_KEY, localCodePath);
    child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY, lambdaFunctionCodeProperty);
    
    const pipelineStack = new cdk.Stack(app, 'PipelineStack');
    const pipeline = new codepipeline.Pipeline(pipelineStack, 'Pipeline');

    // add the source code repository containing this code to your Pipeline,
    // and the source code of the Lambda Function, if they're separate
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      repository: new codecommit.Repository(pipelineStack, 'CodeRepo', {
        repositoryName: 'CodeRepo',
      }),
      actionName: 'Code_Source',
      output: sourceOutput,
    });
   
    
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // synthesize the Lambda CDK template, using CodeBuild
    // the below values are just examples, assuming your CDK code is in TypeScript/JavaScript -
    // adjust the build environment and/or commands accordingly
    const cdkBuildProject = new codebuild.Project(pipelineStack, 'CdkBuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: 'npm install',
          },
          build: {
            commands: [
              'npx aws-cdk --version',
              'npx aws-cdk synth LambdaStack -o .',
            ],
          },
        },
        artifacts: {
          files: 'LambdaStack.template.json',
        },
      }),
    });
    const cdkBuildOutput = new codepipeline.Artifact();
    const cdkBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Build',
      project: cdkBuildProject,
      input: sourceOutput,
      outputs: [cdkBuildOutput],
    });

    // build your Lambda code, using CodeBuild
    // again, this example assumes your Lambda is written in TypeScript/JavaScript -
    // make sure to adjust the build environment and/or commands if they don't match your specific situation
    const lambdaBuildProject = new codebuild.Project(pipelineStack, 'LambdaBuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'cd src/LambdaFunc',
              'pip install -r requirements.txt -t .'
            ],
          },
        },
        artifacts: {
          files: [
            '**/*',
          ],
          'base-directory': 'src/LambdaFunc'
        },
      }),
    });
    const lambdaBuildOutput = new codepipeline.Artifact();
    const lambdaBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Lambda_Build',
      project: lambdaBuildProject,
      input: sourceOutput,
      outputs: [lambdaBuildOutput],
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [cdkBuildAction, lambdaBuildAction],
    });

    // finally, deploy your Lambda Stack
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Lambda_CFN_Deploy',
          templatePath: cdkBuildOutput.atPath('LambdaStack.template.json'),
          stackName: 'LambdaStackDeployedName',
          adminPermissions: true,
          parameterOverrides: lambdaCode.assign(lambdaBuildOutput.s3Location),
          extraInputs: [
            lambdaBuildOutput,
          ],
        }),
      ],
    });
    
  }
}
