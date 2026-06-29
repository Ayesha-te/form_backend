import "dotenv/config";

import app from "./src/app.js";
import { connectToDatabase } from "./src/db.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);

await connectToDatabase();

app.listen(port, () => {
  console.log(`Form backend running at http://localhost:${port}`);
});
