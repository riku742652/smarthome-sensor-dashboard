"""
Lambda Poller for Switchbot Sensor Data
Periodically fetches data from Switchbot API and stores in DynamoDB
"""
import os
import time
import hashlib
import hmac
import base64
import uuid
import json
import requests
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')


def lambda_handler(event, context):
    """
    Lambda handler function
    Triggered by EventBridge every minute
    """
    # Environment variables
    token = os.environ['SWITCHBOT_TOKEN']
    secret = os.environ['SWITCHBOT_SECRET']
    device_id = os.environ['DEVICE_ID']
    table_name = os.environ['TABLE_NAME']

    print(f"Fetching data for device: {device_id}")

    try:
        # Fetch data from Switchbot API
        sensor_data = fetch_switchbot_data(token, secret, device_id)

        # Save to DynamoDB
        save_to_dynamodb(table_name, device_id, sensor_data)

        print("Data saved successfully")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Data saved successfully',
                'data': sensor_data
            })
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Error occurred',
                'error': str(e)
            })
        }


def fetch_switchbot_data(token: str, secret: str, device_id: str) -> dict:
    """
    Fetch sensor data from Switchbot API with authentication
    """
    # Generate authentication headers
    timestamp = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    string_to_sign = f"{token}{timestamp}{nonce}"

    sign = base64.b64encode(
        hmac.new(
            secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
    ).decode('utf-8')

    # API request
    url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/status"
    headers = {
        'Authorization': token,
        't': timestamp,
        'sign': sign,
        'nonce': nonce
    }

    response = requests.get(url, headers=headers, timeout=10)
    data = response.json()

    # Check response status
    if data.get('statusCode') != 100:
        raise Exception(f"Switchbot API error: {data.get('message')}")

    return data['body']


def save_to_dynamodb(table_name: str, device_id: str, sensor_data: dict):
    """
    Save sensor data to DynamoDB
    """
    table = dynamodb.Table(table_name)
    current_time = int(time.time() * 1000)
    expires_at = int(time.time()) + 30 * 24 * 60 * 60  # 30 days later

    item = {
        'deviceId': device_id,
        'timestamp': current_time,
        'temperature': Decimal(str(sensor_data.get('temperature', 0))),
        'humidity': Decimal(str(sensor_data.get('humidity', 0))),
        'co2': sensor_data.get('CO2', 0),
        'expiresAt': expires_at
    }

    table.put_item(Item=item)
    print(f"Saved item: {item}")
