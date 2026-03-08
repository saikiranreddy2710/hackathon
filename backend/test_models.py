import os
import ssl
import asyncio
from dotenv import load_dotenv
from google import genai
from google.genai import types

ssl._create_default_https_context = ssl._create_unverified_context
load_dotenv(r"c:\Hackathon\ClinBridge\.env")

async def main():
    client = genai.Client(api_key=os.environ['GOOGLE_API_KEY'])
    print("Testing gemini-2.0-flash-exp...")
    try:
        async with client.aio.live.connect(
            model='gemini-2.0-flash-exp', 
            config=types.LiveConnectConfig(response_modalities=['AUDIO', 'TEXT'])
        ) as session:
            print('SUCCESS 2.0-flash-exp')
    except Exception as e:
        print(f"FAILED 2.0-flash-exp: {e}")

    print("Testing gemini-2.0-flash...")
    try:
        async with client.aio.live.connect(
            model='gemini-2.0-flash', 
            config=types.LiveConnectConfig(response_modalities=['AUDIO', 'TEXT'])
        ) as session:
            print('SUCCESS 2.0-flash')
    except Exception as e:
        print(f"FAILED 2.0-flash: {e}")

asyncio.run(main())
