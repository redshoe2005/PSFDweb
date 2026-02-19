import boto3

s3 = boto3.client(
    service_name="s3",
    endpoint_url="https://30312ff3dff59eebb2f98fd92e1b67c0.r2.cloudflarestorage.com",
    aws_access_key_id="64f257495a2f4be5d6e7b3d789cd1234",
    aws_secret_access_key="d3b94a0eabea4b14efd79412bb1f6cceeb207e5450427c47e033bfeb0529d5a0",
    region_name="auto",
)
# Upload your CSV file
s3.upload_file(
    Filename="./merged_survey.csv",
    Bucket="psfdweb-data",
    Key="merged_survey.csv",
)