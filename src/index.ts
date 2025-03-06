// Import necessary libraries and modules
import { LinearClient } from "@linear/sdk"; // The official Linear API client
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // MCP server implementation
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // Transport layer for MCP communication
import dotenv from "dotenv"; // For loading environment variables from a .env file
import { z } from "zod"; // For type validation and schema definition

// Initialize dotenv to load environment variables from .env file
dotenv.config();

// Import modules for file operations and path handling
import fs from "fs"; // File system module for reading and writing files
import path from "path"; // For working with file and directory paths
import { fileURLToPath } from "url"; // Converts file URL to file path for ES modules

// Resolve the current directory in ES module context
// In ES modules, __dirname is not available by default, so we create it
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Path to the config file containing the Linear API key
const configPath = path.join(__dirname, "..", "config.json");

// API key resolution strategy with multiple fallbacks:
// 1. Check command line arguments first (most immediate)
const args = process.argv.slice(2); // Get command line arguments without node and script name
let LINEAR_API_KEY = args[0]; // First argument would be the API key

// 2. If not provided in args, check environment variables
if (!LINEAR_API_KEY) {
  LINEAR_API_KEY = process.env.LINEAR_API_KEY || ""; // Use env var or empty string
}

// 3. If API key not in env vars or args, try to load from config file
if (!LINEAR_API_KEY) {
  try {
    // Check if config file exists before attempting to read
    if (fs.existsSync(configPath)) {
      // Parse JSON from config file
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      LINEAR_API_KEY = config.linearApiKey;
      console.error("Loaded API key from config.json"); // Log success to stderr
    }
  } catch (error) {
    // Handle any errors during file reading or JSON parsing
    console.error("Error reading config file:", error);
  }
}

// Exit with an error if we couldn't find the API key from any source
if (!LINEAR_API_KEY) {
  console.error("ERROR: LINEAR_API_KEY not found in command line arguments, environment variables, or config.json");
  process.exit(1); // Exit with error code 1
}

// Initialize the Linear API client with the API key
const linearClient = new LinearClient({
  apiKey: LINEAR_API_KEY
});

// Create a new MCP server instance
// This is the core server that will handle all MCP protocol operations
const server = new McpServer({
  name: "linear-mcp-server", // Identifies this server in the MCP ecosystem
  version: "1.0.0" // Semantic versioning of the server implementation
});

/**  k
 * Prompt: create-task-template
 * Purpose: Provides a template for creating a new task with proper formatting
 * Parameters:
 *   - teamName: Name of the team the task is for (helps with context)
 *   - title: Concise, specific task title
 *   - description: Detailed description of the task
 *   - priority: Priority level (0-4)
 * Returns: A structured message template for creating a new task
 */
server.prompt(
  "create-task-template",
  "Template for creating a new Linear task with proper formatting",
  {
    teamName: z.string().describe("Name of the team this task is for"),
    title: z.string().describe("Concise, specific task title"),
    description: z.string().describe("Detailed description of the task"),
    priority: z.string().describe("Priority level (0-4)")
  },
  async ({ teamName, title, description, priority }) => {
    // Return a prompt template with messages
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I need to create a new task for the ${teamName} team in Linear. 

Please format it using the following structure:

Title: ${title}

Description:
${description}

Priority: ${priority} ${getPriorityLabel(Number(priority))}

Let me know if you need any other information to create this task.`
          }
        }
      ]
    };
  }
);

/**
 * RESOURCE IMPLEMENTATION
 *
 * For read-only operations that provide data to the client, we use resources.
 * Resources are identified by URIs and are meant to be browsed and consumed
 * by clients without causing side effects.
 */

/**
 * Resource: teams
 * Purpose: Provides a list of all teams in the Linear workspace
 * URI: linear://teams
 * Returns: JSON array of team objects
 */
server.resource(
  "teams", // Resource name for client reference
  "linear://teams", // URI for accessing this resource
  async (uri) => {
    // Resource handler function
    try {
      // Query the Linear API for all teams
      const { nodes: teams } = await linearClient.teams();

      // Transform the team data into a simplified format
      const formattedTeams = teams.map((team) => ({
        id: team.id, // Unique identifier for the team
        name: team.name, // Display name of the team
        key: team.key, // Short key used for issue identifiers (e.g., ENG, DES)
        description: team.description || "No description" // Team description with fallback
      }));

      // Return the formatted data as a resource content
      // Resources return "contents" array with URI and data
      return {
        contents: [
          {
            uri: uri.href, // Echo back the requested URI
            text: JSON.stringify(formattedTeams, null, 2), // Pretty-printed JSON
            mimeType: "application/json" // Specify the content type
          }
        ]
      };
    } catch (error) {
      // Handle any errors during API call
      console.error("Error fetching teams:", error);

      // Return an error response
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching teams: ${error instanceof Error ? error.message : String(error)}`,
            mimeType: "text/plain" // Plain text for error messages
          }
        ]
      };
    }
  }
);

/**
 * TOOL IMPLEMENTATION
 *
 * For operations that perform actions, have side effects, or require complex
 * parameter filtering, we use tools. Tools are function-like operations that
 * are called explicitly and may modify state.
 */

/**
 * Tool: get-team-tasks
 * Purpose: Fetches tasks/issues for a specific team with complex filtering options
 * Inputs:
 *   - teamId: ID of the team to fetch tasks for
 *   - states: Optional array of state names to filter by
 *   - limit: Maximum number of tasks to return
 * Output: JSON array of issue objects
 *
 * Note: This remains a tool (rather than resource) because it requires complex filtering
 * parameters that are better handled with explicit tool calls.
 */
server.tool(
  "get-team-tasks",
  "Get tasks for a specific team with filtering options",
  {
    // Define input schema with Zod for runtime validation
    teamId: z.string().describe("ID of the team to fetch tasks for"),
    states: z.array(z.string()).optional().describe("Optional filter for issue states (e.g. 'todo', 'in_progress', 'done')"),
    limit: z.number().optional().default(10).describe("Maximum number of tasks to return (default: 10)")
  },
  // Tool implementation function - executes when the tool is called
  async ({ teamId, states, limit }) => {
    try {
      // Construct a query object for the Linear API
      // This demonstrates how to build complex filters
      const query = {
        filter: {
          team: { id: { eq: teamId } }, // Filter by team ID
          // Conditionally add state filter if states array is provided
          ...(states && states.length > 0 ? { state: { name: { in: states } } } : {})
        },
        first: limit // Pagination limit
      };

      // Execute the query to get issues
      const { nodes: issues } = await linearClient.issues(query);

      // Transform the issue data to a more readable format
      // Handle potential undefined values with fallbacks
      const formattedIssues = issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        state: issue.state ? (issue.state as any).name || "Unknown" : "Unknown",
        assignee: issue.assignee ? (issue.assignee as any).name || "Unassigned" : "Unassigned",
        priority: issue.priority,
        createdAt: issue.createdAt,
        url: issue.url // URL to access the issue in Linear's web interface
      }));

      // Return formatted issues as JSON text
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedIssues, null, 2)
          }
        ]
      };
    } catch (error) {
      // Handle and log any errors
      console.error("Error fetching team tasks:", error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error fetching team tasks: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: create-task
 * Purpose: Creates a new task/issue in a specific team (state-modifying operation)
 * Inputs:
 *   - teamId: ID of the team where the task will be created
 *   - title: Title of the new task
 *   - description: Optional description of the task
 *   - assigneeId: Optional ID of the user to assign the task to
 *   - priority: Optional priority level (0-4)
 *   - stateId: Optional workflow state ID
 * Output: JSON object with details of the created task
 */
server.tool(
  "create-task",
  "Create a new task for a team",
  {
    // Define input schema with validation requirements
    teamId: z.string().describe("ID of the team to create the task for"),
    title: z.string().describe("Title of the task"),
    description: z.string().optional().describe("Description of the task"),
    assigneeId: z.string().optional().describe("ID of the user to assign the task to"),
    priority: z.number().optional().describe("Priority of the task (0-4, where 0 is no priority)"),
    stateId: z.string().optional().describe("ID of the state to set for the task")
  },
  // Tool implementation function
  async ({ teamId, title, description, assigneeId, priority, stateId }) => {
    try {
      // Call the Linear API to create a new issue
      const issue = await linearClient.createIssue({
        teamId,
        title,
        description,
        assigneeId,
        priority,
        stateId
      });

      // Extract issue details safely from the response
      const createdIssue = (issue as any).issue || issue;
      const issueId = createdIssue.id || "unknown";
      const issueTitle = createdIssue.title || "unknown";
      const issueUrl = createdIssue.url || "";

      // Return success response with issue details
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: issueId,
                title: issueTitle,
                url: issueUrl,
                message: "Task created successfully"
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Handle errors during task creation
      console.error("Error creating task:", error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error creating task: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: update-task
 * Purpose: Updates an existing task/issue with new details (state-modifying operation)
 * Inputs:
 *   - issueId: ID of the issue to update
 *   - title: Optional new title for the task
 *   - description: Optional new description for the task
 *   - assigneeId: Optional ID of the user to assign the task to
 *   - priority: Optional new priority level (0-4)
 *   - stateId: Optional new workflow state ID
 * Output: JSON object with details of the updated task
 */
server.tool(
  "update-task",
  "Update an existing task",
  {
    // Define input schema with validation and descriptions
    issueId: z.string().describe("ID of the issue to update"),
    title: z.string().optional().describe("New title for the task"),
    description: z.string().optional().describe("New description for the task"),
    assigneeId: z.string().optional().describe("ID of the user to assign the task to"),
    priority: z.number().optional().describe("New priority of the task (0-4, where 0 is no priority)"),
    stateId: z.string().optional().describe("ID of the new state for the task")
  },
  // Tool implementation function
  async ({ issueId, title, description, assigneeId, priority, stateId }) => {
    try {
      // Call the Linear API to update an existing issue
      // Only the provided fields will be updated
      const issue = await (linearClient as any).issueUpdate(issueId, {
        title,
        description,
        assigneeId,
        priority,
        stateId
      });

      // Return success response with updated issue details
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: issue.issue.id,
                title: issue.issue.title,
                url: issue.issue.url,
                message: "Task updated successfully"
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Handle errors during task update
      console.error("Error updating task:", error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error updating task: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Helper function to get priority label
function getPriorityLabel(priority: number): string {
  const labels = ["(No priority)", "(Low)", "(Medium)", "(High)", "(Urgent)"];
  return labels[priority] || "";
}

/**
 * Main function to initialize and start the MCP server
 * This function sets up the transport layer and connects the server
 */
async function main() {
  try {
    // Log startup message
    console.error("Linear MCP Server starting...");

    // Create a stdio transport for communication
    // This allows the server to communicate via standard input/output streams
    const transport = new StdioServerTransport();

    // Connect the server to the transport
    // This starts listening for incoming MCP protocol messages
    await server.connect(transport);

    // Log successful startup
    console.error("Linear MCP Server running...");
  } catch (error) {
    // Handle any errors during server startup
    console.error("Error starting Linear MCP Server:", error);
    process.exit(1); // Exit with error code 1
  }
}

// Start the server by calling the main function
main();
