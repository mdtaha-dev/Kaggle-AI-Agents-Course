# ruff: noqa
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

# ── Auth ──────────────────────────────────────────────────────────────────────
# Credentials are read from .env at the project root (loaded by agents-cli /
# ADK runner automatically, or by python-dotenv if running directly).
# Set GOOGLE_API_KEY for AI Studio, or GOOGLE_CLOUD_PROJECT +
# GOOGLE_GENAI_USE_VERTEXAI=True for Vertex AI.  See .env for details.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from pydantic import BaseModel

from google.adk.agents import LlmAgent
from google.adk.agents.context import Context
from google.adk.apps import App
from google.adk.events.event import Event
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow
from google.genai import types

# ── Output schemas ────────────────────────────────────────────────────────────


class ExpenseExtraction(BaseModel):
    """Structured output from the LLM extraction step."""

    description: str
    amount_usd: float
    category: str  # e.g. "travel", "meals", "software", "other"
    needs_review: bool  # True when amount > 200 or category is ambiguous


class ExpenseRecord(BaseModel):
    """Final, approved expense record written to state."""

    description: str
    amount_usd: float
    category: str
    approved: bool
    reviewer_note: str = ""


# ── LLM node: extract & classify ─────────────────────────────────────────────

extractor = LlmAgent(
    name="extractor",
    model="gemini-flash-latest",
    instruction=(
        "You are an expense-parsing assistant. "
        "Extract the expense description, amount in USD, and category from the "
        "user's message. Set needs_review=True if amount > 200 or the category "
        "is ambiguous. Respond ONLY with the JSON schema."
    ),
    output_schema=ExpenseExtraction,
    output_key="extraction",  # also stored in ctx.state["extraction"]
)

# ── Function nodes ────────────────────────────────────────────────────────────


def route_expense(node_input: dict) -> Event:
    """Decide whether the expense needs human review or can auto-approve."""
    extraction = ExpenseExtraction(**node_input)
    route = "review" if extraction.needs_review else "auto_approve"
    return Event(output=node_input, route=route)


async def human_review(ctx: Context, node_input: dict):
    """Human-in-the-loop step using RequestInput (ADK 2.0 HITL)."""
    extraction = ExpenseExtraction(**node_input)

    # First pass: ask for approval
    if "approval" not in ctx.resume_inputs:
        summary = (
            f"Expense needs review:\n"
            f"  Description : {extraction.description}\n"
            f"  Amount      : ${extraction.amount_usd:.2f}\n"
            f"  Category    : {extraction.category}\n"
            "Reply 'approve' or 'reject [reason]':"
        )
        yield RequestInput(interrupt_id="approval", message=summary)
        return

    reply: str = ctx.resume_inputs["approval"].strip().lower()
    approved = reply.startswith("approve")
    note = reply if not approved else ""

    record = ExpenseRecord(
        description=extraction.description,
        amount_usd=extraction.amount_usd,
        category=extraction.category,
        approved=approved,
        reviewer_note=note,
    )
    yield Event(
        output=record.model_dump(),
        state={"expense_record": record.model_dump()},
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(
                text=f"✅ Expense {'approved' if approved else 'rejected'}."
                + (f" Reason: {note}" if note else "")
            )],
        ),
    )


def auto_approve(node_input: dict) -> Event:
    """Automatically approve low-value, unambiguous expenses."""
    extraction = ExpenseExtraction(**node_input)
    record = ExpenseRecord(
        description=extraction.description,
        amount_usd=extraction.amount_usd,
        category=extraction.category,
        approved=True,
        reviewer_note="auto-approved",
    )
    return Event(
        output=record.model_dump(),
        state={"expense_record": record.model_dump()},
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(
                text=f"✅ Auto-approved: {extraction.description} (${extraction.amount_usd:.2f})"
            )],
        ),
    )


# ── Workflow graph ─────────────────────────────────────────────────────────────
#
#   START ──► extractor ──► route_expense ──► [review]        human_review
#                                         └──► [auto_approve]  auto_approve
#

root_agent = Workflow(
    name="expense_workflow",
    description="Ambient expense agent: extracts, classifies, and routes expenses for approval.",
    edges=[
        # 1. Entry → LLM extraction
        ("START", extractor),
        # 2. Extraction → routing function
        (extractor, route_expense),
        # 3. Conditional routing: RoutingMap dict { route_label: target_node }
        (route_expense, {"review": human_review, "auto_approve": auto_approve}),
    ],
)

app = App(
    root_agent=root_agent,
    name="app",
)
