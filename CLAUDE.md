# Project: Travel Guide App

## Notion Task Tracking

The project uses a Notion database for task management.

- **Database URL**: https://www.notion.so/30d4d574af1180a7a80fcec24e8b17c2?v=30d4d574af118004b846000ce570df20
- **Data source ID**: `collection://30d4d574-af11-80e7-8ff5-000b0453c009`

### How to read the task list

1. Fetch the database using `notion-fetch` with the database URL/ID above
2. Search for tasks using `notion-search` with `data_source_url: "collection://30d4d574-af11-80e7-8ff5-000b0453c009"`
3. Fetch individual tasks by their page ID to get full details (description, status, priority, etc.)

### Task properties

| Property     | Type         | Values                                      |
|--------------|--------------|---------------------------------------------|
| Task name    | Title        | —                                           |
| Status       | Status       | Not started, In progress, Done              |
| Priority     | Select       | High, Medium, Low                           |
| Effort level | Select       | Small, Medium, Large                        |
| Task type    | Multi-select | Bug, Feature request, Polish                |
| Due date     | Date         | —                                           |
| Assignee     | Person       | —                                           |
| Description  | Text         | —                                           |

### Important notes

- **Ignore "New task"**: The task with an empty title or named "New task" is a template placeholder — it should be ignored and not worked on.
