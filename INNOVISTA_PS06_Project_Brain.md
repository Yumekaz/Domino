# Problem Statement 06

# The Institutional Amnesia Problem: Project Brain

*A “delivery memory” system that remembers why code was written and what could break when it changes.*

**Focus Area:** AI | Knowledge Management | Developer Tools

---

## Background

As software projects grow, important context gets scattered across **Git commit history, Jira tickets, Slack threads, and Confluence documentation.**

## Problem Statement

> **The Gap:** When a senior developer leaves, their knowledge leaves with them. It becomes very hard for the remaining team to understand **why a piece of code was written a certain way**, or to predict **what will break** (the “blast radius”) if they change it.
>
> **The Challenge:** How might we build an intelligent **“delivery memory”** system that connects a project’s scattered history to answer complex design questions and show the impact of new code changes, without relying on human memory?

## Your Goal

Give any team member a place to ask “why was this built this way?” and “what will this change affect?” and get answers backed by real project history.

## Who Will Use It

- **New team members** who are learning an unfamiliar codebase.
- **Developers and tech leads** who plan changes and reviews.
- **Testers** who need to know which areas to re-check after a change.

## What to Build

### Minimum Working Version

**Do all three items below.**

- **Project History Collection:** Gather project data from sources such as commits, tickets, chat messages, and documents. You may use a public open-source project’s commits, issues, and pull requests as a stand-in.
- **Connected Memory:** Link related items together (for example, a commit to its ticket and to the discussion about it) so that history can be followed from one place to another.
- **Question Answering:** Answer questions like “Why was this code written this way?” and **show the sources used.**
- **Impact Check:** Given a proposed change, list the files, features, or components that **might be affected**, with a reason for each.

## Bonus Goals (Optional)

- **Visual map:** Show the connections between code, tickets, and people as a graph.
- **Pull request check:** Show the impact summary automatically on each new change.
- **Knowledge at risk:** Highlight code that only one person has ever worked on.

## Suggested Tools and Resources

- **Data:** Public GitHub repositories with their issues and pull requests, and Git logs.
- **Storage and search:** A vector database, or a graph tool such as Neo4j or NetworkX.
- **AI model:** Any LLM of your choice.

## Rules to Follow

- **Cite sources:** Every answer must point to the commit, ticket, or message it came from.
- **Say “not found”:** If there is no history to support an answer, say so instead of guessing.
- **Public or sample data only.**

---

*Source document: INNOVISTA | 36-Hour Hackathon | Problem Statements. The supplied screenshots include the original “Page 16” footer.*
