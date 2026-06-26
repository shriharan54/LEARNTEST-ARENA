from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
import json
import os
import google.generativeai as genai
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)

app = FastAPI(title="LearnTest Arena AI Backend")

# Allow Node.js to access this via CORS if needed (for direct requests, though server.js handles it usually)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pypdf or PyPDF2 as fallback."""
    from io import BytesIO
    pdf_stream = BytesIO(pdf_bytes)
    extracted_text = []

    try:
        from pypdf import PdfReader as PypdfReader
        reader = PypdfReader(pdf_stream)
        for page in reader.pages:
            text = page.extract_text()
            if text:
                extracted_text.append(text)
        print(f"PDF parsed with pypdf: {len(reader.pages)} pages")
    except Exception as e1:
        print(f"pypdf failed ({e1}), trying PyPDF2...")
        pdf_stream.seek(0)
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(pdf_stream)
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    extracted_text.append(text)
            print(f"PDF parsed with PyPDF2: {len(reader.pages)} pages")
        except Exception as e2:
            print(f"PyPDF2 also failed: {e2}")
            return "[Could not extract PDF text. Please ensure the PDF contains selectable text, not scanned images.]"

    combined = "\n".join(extracted_text)
    # Cap at 15000 chars to stay within Gemini token limits
    result = combined[:15000] if len(combined) > 15000 else combined
    print(f"Extracted {len(result)} characters from PDF.")
    return result

@app.post("/extract_pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """
    Accepts a PDF file upload and returns the extracted text.
    This is called directly from the frontend via fetch (bypassing Socket.IO limits).
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")
    try:
        pdf_bytes = await file.read()
        text = extract_text_from_pdf_bytes(pdf_bytes)
        # Estimate page count based on bytes, assuming ~35KB per page
        page_count = max(1, round(len(pdf_bytes) / 35000))
        return {
            "success": True,
            "text": text,
            "charCount": len(text),
            "estimatedPages": page_count
        }
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF: {str(e)}")


class QuizRequest(BaseModel):
    topic: str
    numQuestions: int = 5
    fileContent: Optional[str] = ""

class Question(BaseModel):
    question: str
    options: List[str]
    answer: int
    time: int
    explanation: str = ""

class QuizResponse(BaseModel):
    title: str
    questions: List[Question]

@app.post("/generate_quiz", response_model=QuizResponse)
async def generate_quiz(req: QuizRequest):
    """
    Generates a quiz based on the topic using Gemini AI.
    """
    if not API_KEY:
        # Fallback to communicate to the user visually
        return {
            "title": "Error: Missing API Key",
            "questions": [
                {
                    "question": "Please add GEMINI_API_KEY to python_backend/.env to use AI. Restart python server.",
                    "options": ["Acknowledge", "Ignore", "Cancel", "Retry"],
                    "answer": 0,
                    "time": 20,
                    "explanation": "A GEMINI_API_KEY must be set in python_backend/.env for AI quiz generation to work."
                }
            ]
        }

    if req.fileContent and req.fileContent.startswith("PDF_BASE64:"):
        try:
            import base64
            from io import BytesIO

            b64_string = req.fileContent[len("PDF_BASE64:"):]
            pdf_data = base64.b64decode(b64_string)
            pdf_stream = BytesIO(pdf_data)

            extracted_text = []

            # Try modern pypdf first
            try:
                from pypdf import PdfReader as PypdfReader
                reader = PypdfReader(pdf_stream)
                for page in reader.pages:
                    text = page.extract_text()
                    if text:
                        extracted_text.append(text)
                print(f"PDF parsed with pypdf: {len(reader.pages)} pages")
            except Exception as e1:
                print(f"pypdf failed ({e1}), trying PyPDF2...")
                pdf_stream.seek(0)
                try:
                    import PyPDF2
                    reader = PyPDF2.PdfReader(pdf_stream)
                    for page in reader.pages:
                        text = page.extract_text()
                        if text:
                            extracted_text.append(text)
                    print(f"PDF parsed with PyPDF2: {len(reader.pages)} pages")
                except Exception as e2:
                    print(f"PyPDF2 also failed: {e2}")
                    extracted_text = ["[Could not extract PDF text - please ensure the PDF contains selectable text, not scanned images.]"]

            combined = "\n".join(extracted_text)
            # Cap at 15000 chars to stay within Gemini token limits
            req.fileContent = combined[:15000] if len(combined) > 15000 else combined
            print(f"Extracted {len(req.fileContent)} characters from PDF.")
        except Exception as e:
            print(f"Failed to parse PDF: {e}")
            req.fileContent = "Error extracting PDF text."

    prompt = f"""Generate exactly {req.numQuestions} multiple-choice trivia questions about the topic "{req.topic}".
    {f'Use the following context text if relevant: {req.fileContent}' if req.fileContent else ''}
    Return strictly valid JSON with this structure:
    {{
      "title": "{req.topic.title()} Quiz",
      "questions": [
        {{
          "question": "Question text?",
          "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
          "answer": 0,
          "time": 20,
          "explanation": "A clear, friendly explanation (2-3 sentences) of why the correct answer is right. Use simple language suitable for students."
        }}
      ]
    }}
    Rules:
    - There MUST be exactly 4 options per question.
    - The "answer" field must be an integer (0, 1, 2, or 3) representing the index of the correct option.
    - The "explanation" field MUST be present for every question. Write it in simple, student-friendly language that explains WHY the correct answer is right.
    - Do not return any markdown blocks or backticks, just the raw JSON object.
    """
    
    try:
        # Standard model names: gemini-1.5-flash is fast/cheap, gemini-1.5-pro is more capable
        model_names = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']
        model = None
        response = None
        
        import traceback
        # Attempt to find the best available model dynamically
        preferred_models = ['gemini-3.1-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']
        model_names = preferred_models.copy()
        
        # Optionally add all available models that support generateContent
        try:
            available_models = [m.name.replace('models/', '') for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
            for am in available_models:
                if am not in model_names:
                    model_names.append(am)
            print(f"Available models found: {model_names}")
        except Exception as list_e:
            print(f"Could not list models: {list_e}")

        for m_name in model_names:
            try:
                print(f"Attempting to use Gemini model: {m_name}")
                model = genai.GenerativeModel(m_name)
                response = model.generate_content(prompt)
                if response:
                    print(f"Successfully generated content with {m_name}")
                    break
            except Exception as inner_e:
                print(f"Failed to use {m_name}: {str(inner_e)}")
                continue
        
        if not response:
            error_msg = f"All attempted Gemini models failed. Models tried: {model_names}. Please check your API key permissions."
            print(f"CRITICAL: {error_msg}")
            raise Exception(error_msg)
                
        text = response.text.strip()
        
        # Clean up markdown JSON formatting if the model outputs it
        if text.startswith('```json'):
            text = text[7:-3].strip()
        elif text.startswith('```'):
            text = text[3:-3].strip()
            
        data = json.loads(text)
        
        # Ensure 'time' and 'explanation' are present on all
        for q in data.get("questions", []):
            if "time" not in q:
                q["time"] = 20
            if "explanation" not in q or not q["explanation"]:
                q["explanation"] = f"The correct answer is option {q.get('answer', 0) + 1}. Review your study material for more details."
                
        return data
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        # Return a mock quiz to ensure frontend can proceed
        mock_questions = []
        for i in range(req.numQuestions):
            mock_questions.append({
                "question": f"Sample question {i+1} about {req.topic}?",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "answer": 0,
                "time": 20,
                "explanation": f"Option A is correct for this sample question about {req.topic}. In a real quiz, Gemini AI would explain exactly why the answer is correct in student-friendly language."
            })
        return {
            "title": f"{req.topic.title()} Quiz (Mock)",
            "questions": mock_questions
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
