# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.events.event import Event, EventActions
from google.adk.workflow import Workflow
from google.genai import types
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Pydantic schema for the classifier's structured output
# ---------------------------------------------------------------------------


class Classification(BaseModel):
    """Structured output from the classifier agent."""

    category: str  # "shipping" or "unrelated"


# ---------------------------------------------------------------------------
# Node 1 — init_session
# Extract the user's text from the START Content and store it in state.
# ---------------------------------------------------------------------------


def init_session(node_input: types.Content) -> Event:
    """Extract raw user text from the START node's Content object."""
    text = ""
    for part in node_input.parts or []:
        if hasattr(part, "text") and part.text:
            text = part.text
            break
    return Event(output=text, actions=EventActions(state_delta={"user_query": text}))


# ---------------------------------------------------------------------------
# Node 2 — classifier_agent  (LlmAgent)
# Classifies the query as "shipping" or "unrelated".
# ---------------------------------------------------------------------------

classifier_agent = LlmAgent(
    name="classifier_agent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a query classifier for a shipping company customer support system.\n"
        "Classify the user's query into exactly one of these two categories:\n"
        '  - "shipping" — if the query is about shipping rates, tracking, '
        "delivery times, returns, lost packages, or any other shipping topic.\n"
        '  - "unrelated" — if the query is about anything else.\n'
        "Return ONLY the JSON object with the category field. No extra text."
    ),
    output_schema=Classification,
    output_key="classification",
)


# ---------------------------------------------------------------------------
# Node 3 — route_query
# Read the classifier's output from state and emit a routing event.
# ---------------------------------------------------------------------------


def route_query(classification: dict) -> Event:  # type: ignore[type-arg]
    """Route based on classification stored in state."""
    category = classification.get("category", "unrelated")
    return Event(output=category, actions=EventActions(route=category))


# ---------------------------------------------------------------------------
# Node 4 — shipping_faq_agent  (LlmAgent)
# Answers shipping-related questions as a helpful customer support rep.
# ---------------------------------------------------------------------------

shipping_faq_agent = LlmAgent(
    name="shipping_faq_agent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a knowledgeable and friendly customer support representative "
        "for a shipping company. Answer the customer's question helpfully and "
        "concisely. Topics you can help with include: shipping rates, package "
        "tracking, delivery times, returns and refunds, lost or damaged packages, "
        "and general shipping policies. If you don't know a specific detail, "
        "suggest the customer check the company website or contact support."
    ),
)


# ---------------------------------------------------------------------------
# Node 5 — decline_query
# Politely declines to answer unrelated queries and emits a visible message.
# ---------------------------------------------------------------------------


def decline_query(node_input: str) -> Event:
    """Return a polite decline message for off-topic queries."""
    message = (
        "I'm sorry, but I can only assist with shipping-related questions such as "
        "rates, tracking, delivery, and returns. For other inquiries, please reach "
        "out to the appropriate service. Is there anything shipping-related I can "
        "help you with today?"
    )
    return Event(
        output=message,
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(text=message)],
        ),
    )


# ---------------------------------------------------------------------------
# Workflow graph
# ---------------------------------------------------------------------------

root_agent = Workflow(
    name="customer_support_workflow",
    description=(
        "A customer support workflow for a shipping company. "
        "Classifies queries and routes to the appropriate handler."
    ),
    edges=[
        # Entry: extract text from user message
        ("START", init_session),
        # Classify the query
        (init_session, classifier_agent),
        # Route based on classification
        (classifier_agent, route_query),
        # Shipping branch
        (route_query, shipping_faq_agent, "shipping"),
        # Unrelated branch
        (route_query, decline_query, "unrelated"),
        # Fallback (safety net)
        (route_query, decline_query, "__DEFAULT__"),
    ],
)

app = App(
    root_agent=root_agent,
    name="app",
)
