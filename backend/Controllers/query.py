from fastapi import APIRouter
from dotenv import load_dotenv
import os
from mcp import ClientSession, StdioServerParameters
from Views.oneQuery import baseQuery
from mcp.client.stdio import stdio_client
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_mcp_adapters.tools import load_mcp_tools

router = APIRouter()
load_dotenv()

chat_history = []

GOOGLE_GEMINI_API_KEY=os.getenv("GOOGLE_GEMINI_API_KEY")


def extract_assistant_reply(result):
    """Extract the model's reply text from the LangGraph result object."""
    if isinstance(result, dict) and "messages" in result:
        msgs = result["messages"]
        if len(msgs) > 0:
            last = msgs[-1]
            if hasattr(last, "content"):
                return last.content
            if isinstance(last, dict) and "content" in last:
                return last["content"]
    return "I'm here."


@router.get("/")
def send_breating_msg():
    return {"message": "I am Jinda Here !!"}


@router.post("/query")
async def Process_user_query(query: baseQuery):
    server_script_path = "./Server/main.py"
    command = "python"
    server_params = StdioServerParameters(
        command=command,
        args=[server_script_path],
        env=None
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await load_mcp_tools(session)

            chat_model = ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                api_key=GOOGLE_GEMINI_API_KEY
            )

            SYSTEM_PROMPT = """
You are a daily health & wellness voice companion.
Your purpose is to support the user with short daily check-ins about their mood, energy, and goals, and to log those check-ins using MCP tools.

Your tone must be:
- Warm, supportive, and grounded
- Non-clinical (no medical advice, no diagnosis)
- Concise and conversational

------------------------------------------------------------
1. DAILY CHECK-IN FLOW
------------------------------------------------------------

A. Begin with gentle questions:
- “How are you feeling today?”
- “What’s your energy like right now?”
- “Anything on your mind today?”

...
(Full prompt unchanged)
"""

            # Initialize agent
            agent = create_react_agent(
                chat_model,
                tools,
                prompt=SystemMessage(SYSTEM_PROMPT)
            )

            # -----------------------------------------
            # 🟢 IF FIRST INTERACTION → AGENT SPEAKS FIRST
            # -----------------------------------------
            if len(chat_history) == 0:
                # Add system prompt into history
                chat_history.append(SystemMessage(SYSTEM_PROMPT))

                # First message from the agent
                first_agent_message = (
                    "Hi, it's good to connect with you again. "
                    "How are you feeling today?"
                )

                chat_history.append(AIMessage(first_agent_message))

                return {"message": first_agent_message}

            # -----------------------------------------
            # 📝 USER REPLIED → PROCESS THEIR MESSAGE
            # -----------------------------------------
            chat_history.append(HumanMessage(query.Query_body))

            result = await agent.ainvoke({"messages": chat_history})

            assistant_reply = extract_assistant_reply(result)

            chat_history.append(AIMessage(assistant_reply))

            return {"message": assistant_reply}
