import handleRequest from "../server.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(request, response) {
  return handleRequest(request, response);
}
