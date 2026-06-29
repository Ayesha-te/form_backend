import "dotenv/config";

import mongoose from "mongoose";

const connectionState = globalThis.__formLoveBuildDb ?? {
  connection: null,
  promise: null,
};

globalThis.__formLoveBuildDb = connectionState;

export async function connectToDatabase() {
  if (connectionState.connection) {
    return connectionState.connection;
  }

  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB ?? "form_love_build";

  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI for the backend.");
  }

  if (!connectionState.promise) {
    connectionState.promise = mongoose.connect(mongoUri, {
      dbName: databaseName,
      serverSelectionTimeoutMS: 10000,
    });
  }

  connectionState.connection = await connectionState.promise;
  return connectionState.connection;
}
