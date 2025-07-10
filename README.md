# Submission Service (Fastify + TypeScript)

## Usage

- Source code is in `src/` (TypeScript)
- Build: `npm run build` (outputs to `dist/`)
- Dev: `npm run dev` (auto-reloads)
- Start: `npm start` (builds and runs)

## Endpoints

- `POST /api/submissions/create?problemId=...` (protected, JWT)
  - Body: `{ userCode: string, language: string }`

## Environment Variables

- `MONGO_URI` (MongoDB connection string)
- `JWT_SECRET` (JWT secret)
- `PROBLEM_SERVICE_URL` (URL to Problem Service)
- `PORT` (default: 5001)
