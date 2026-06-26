import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

try:
    genai.configure(api_key=api_key)
    print("Listing models...")
    for m in genai.list_models():
        print(f"Model ID: {m.name}, Methods: {m.supported_generation_methods}")
except Exception as e:
    print(f"Error Listing Models: {e}")
