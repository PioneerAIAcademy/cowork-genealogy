import { Greeting } from "../types/greeting.js";

export const helloToolSchema = {
  name: "hello",
  description: "Generate a greeting for a person by name. Use this " +
    "when the user wants to say hello to someone.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the person to greet"
      }
    },
    required: ["name"]
  }
};

export function helloTool(args: { name: string }): Greeting {
  return {
    greeting: `Hello, ${args.name}!`,
    timestamp: new Date().toISOString()
  };
}
