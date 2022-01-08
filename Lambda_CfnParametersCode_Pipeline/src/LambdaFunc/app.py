import json
import names

def lambda_handler(event, context):
  name = names.get_first_name()

  response = {
    "statusCode": 200,
    "body": json.dumps({
     "first-name": name,
    }),
  }
  return response