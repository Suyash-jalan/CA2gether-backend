# CA2gether — Backend API

A comprehensive REST API + WebSocket backend for **CA2gether**, a dating and networking platform exclusively for Chartered Accountants and CA students.

> **⚠️ Production Note:** This backend must run behind HTTPS in production. Use a reverse proxy (e.g., Nginx) with SSL termination.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | MongoDB (Mongoose ODM) |
| Auth | JWT (access + refresh tokens), bcryptjs |
| Real-time | Socket.io |
| File storage | Cloudinary (optional) / local disk fallback |
| Validation | express-validator |
| Security | helmet, cors, express-rate-limit, express-mongo-sanitize, xss-clean |
| Logging | Winston + Morgan |

---

## Quick Start

```bash
# 1. Clone and enter the backend directory
cd backend

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secrets, email creds, etc.

# 4. Start MongoDB (local)
mongod

# 5. Run in development mode
npm run dev

# 6. The API will be available at http://localhost:5000
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `MONGO_URI` | MongoDB connection string |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting ICAI numbers at rest |
| `FRONTEND_URL` | Frontend origin for CORS and email links |
| `EMAIL_HOST/USER/PASS` | SMTP credentials for transactional emails |
| `CLOUDINARY_*` | (Optional) Cloudinary credentials; omit for local disk storage |

---

## Project Structure

```
backend/
├── config/
│   ├── db.js              # MongoDB connection
│   ├── cloudinary.js       # Cloudinary configuration
│   └── socket.js           # Socket.io initialisation + chat handlers
├── controllers/
│   ├── authController.js   # Signup, login, token refresh, password reset
│   ├── userController.js   # Profile CRUD, photo upload, verification
│   ├── matchController.js  # Swipe, discovery feed, matches
│   ├── chatController.js   # Chat history, icebreakers
│   ├── communityController.js # Posts, comments, events (CA Lounge)
│   ├── safetyController.js # Block/report users
│   ├── adminController.js  # Admin panel operations
│   └── notificationController.js # Notification retrieval
├── middleware/
│   ├── auth.js             # JWT verification + email-verified guard
│   ├── admin.js            # Admin role guard
│   ├── blockFilter.js      # Loads blocked user IDs for downstream filtering
│   ├── ownership.js        # Ownership check factory (edit/delete)
│   ├── rateLimiter.js      # Rate limiting configs
│   ├── upload.js           # Multer config (file type/size restrictions)
│   ├── validate.js         # express-validator error handler
│   └── errorHandler.js     # Centralised error handler
├── models/
│   ├── User.js             # User schema with CA fields
│   ├── RefreshToken.js     # Refresh token store with TTL
│   ├── Swipe.js            # Like/pass actions
│   ├── Match.js            # Mutual matches
│   ├── Message.js          # Chat messages
│   ├── Post.js             # Forum posts
│   ├── Comment.js          # Post comments
│   ├── Event.js            # Community events
│   ├── Block.js            # User blocks
│   ├── Report.js           # User reports
│   ├── Notification.js     # Notification events
│   └── AdminLog.js         # Admin audit log
├── routes/
│   ├── authRoutes.js
│   ├── userRoutes.js
│   ├── matchRoutes.js
│   ├── chatRoutes.js
│   ├── communityRoutes.js
│   ├── safetyRoutes.js
│   ├── adminRoutes.js
│   └── notificationRoutes.js
├── utils/
│   ├── logger.js           # Winston logger with sensitive-data redaction
│   ├── email.js            # Nodemailer wrapper + email templates
│   ├── encryption.js       # AES-256-CBC encrypt/decrypt for ICAI numbers
│   ├── sanitize.js         # HTML tag stripper for user content
│   └── icebreakerPrompts.js # 30 CA-themed conversation starters
├── uploads/                # Local file storage (gitignored)
├── logs/                   # Log files (gitignored)
├── .env.example
├── .gitignore
├── package.json
├── server.js               # Application entry point
└── README.md
```

---

## API Endpoints

### Health Check

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | ✗ | Server health check |

### Authentication (`/api/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/signup` | ✗ | Register new account |
| `POST` | `/api/auth/login` | ✗ | Login (returns access + refresh token) |
| `POST` | `/api/auth/refresh-token` | Cookie | Rotate refresh token, get new access token |
| `POST` | `/api/auth/logout` | ✓ | Revoke refresh token + clear cookie |
| `GET` | `/api/auth/verify-email/:token` | ✗ | Verify email address |
| `POST` | `/api/auth/resend-verification` | ✓ | Resend verification email |
| `POST` | `/api/auth/forgot-password` | ✗ | Send password reset email |
| `POST` | `/api/auth/reset-password/:token` | ✗ | Reset password with token |
| `GET` | `/api/auth/me` | ✓ | Get current user basic info |

### User Profile (`/api/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/users/me` | ✓ | Get full profile |
| `PUT` | `/api/users/me` | ✓ | Update profile fields |
| `POST` | `/api/users/me/photos` | ✓ | Upload photos (max 6, multipart) |
| `DELETE` | `/api/users/me/photos` | ✓ | Delete a photo (`{ photoUrl }`) |
| `POST` | `/api/users/me/verification` | ✓ | Upload ICAI verification doc + number |
| `POST` | `/api/users/me/deactivate` | ✓ | Deactivate account |
| `POST` | `/api/users/me/reactivate` | ✓ | Reactivate account |
| `GET` | `/api/users/:id` | ✓ ✉ | View another user's profile |

> ✉ = requires verified email

### Matching (`/api/match`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/match/swipe` | ✓ ✉ | Swipe like/pass (`{ targetUserId, action, mode? }`) |
| `GET` | `/api/match/discover` | ✓ ✉ | Discovery feed (query: city, caStatus, firmType, specialization, examBuddyMode, page, limit) |
| `GET` | `/api/match/matches` | ✓ ✉ | List my matches (query: mode, page, limit) |
| `DELETE` | `/api/match/matches/:matchId` | ✓ ✉ | Unmatch |

### Chat (`/api/chat`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/chat/:matchId/messages` | ✓ ✉ | Get chat history (query: page, limit) |
| `GET` | `/api/chat/icebreakers` | ✓ ✉ | Random icebreaker prompts (query: count) |

#### Socket.io Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `join_chat` | Client → Server | `{ matchId }` | Join a chat room |
| `joined_chat` | Server → Client | `{ matchId }` | Confirmation of room join |
| `send_message` | Client → Server | `{ matchId, content }` | Send a message |
| `new_message` | Server → Client | Message object | New message broadcast |
| `typing` | Client → Server | `{ matchId }` | Typing indicator |
| `user_typing` | Server → Client | `{ userId }` | User is typing |
| `stop_typing` | Client → Server | `{ matchId }` | Stop typing |
| `user_stop_typing` | Server → Client | `{ userId }` | User stopped typing |
| `leave_chat` | Client → Server | `{ matchId }` | Leave chat room |
| `error_msg` | Server → Client | `{ message }` | Error message |
| `notification` | Server → Client | `{ type, ... }` | Push notification |

> Socket.io auth: pass JWT access token via `auth.token` in the handshake.

### Community / CA Lounge (`/api/community`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/community/posts` | ✓ ✉ | Create forum post |
| `GET` | `/api/community/posts` | ✓ ✉ | List posts (query: tag, page, limit) |
| `GET` | `/api/community/posts/:id` | ✓ ✉ | Get single post |
| `PUT` | `/api/community/posts/:id` | ✓ ✉ 👤 | Update post (owner/admin only) |
| `DELETE` | `/api/community/posts/:id` | ✓ ✉ 👤 | Delete post + comments (owner/admin) |
| `POST` | `/api/community/posts/:postId/comments` | ✓ ✉ | Add comment |
| `GET` | `/api/community/posts/:postId/comments` | ✓ ✉ | List comments |
| `PUT` | `/api/community/comments/:id` | ✓ ✉ 👤 | Update comment (owner/admin) |
| `DELETE` | `/api/community/comments/:id` | ✓ ✉ 👤 | Delete comment (owner/admin) |
| `POST` | `/api/community/events` | ✓ ✉ | Create event |
| `GET` | `/api/community/events` | ✓ ✉ | List events |
| `GET` | `/api/community/events/:id` | ✓ ✉ | Get single event |
| `PUT` | `/api/community/events/:id` | ✓ ✉ 👤 | Update event (owner/admin) |
| `DELETE` | `/api/community/events/:id` | ✓ ✉ 👤 | Delete event (owner/admin) |

> 👤 = ownership check (owner or admin)

### Safety (`/api/safety`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/safety/block/:userId` | ✓ ✉ | Block user |
| `DELETE` | `/api/safety/block/:userId` | ✓ ✉ | Unblock user |
| `GET` | `/api/safety/blocked` | ✓ ✉ | List blocked users |
| `POST` | `/api/safety/report/:userId` | ✓ ✉ | Report user (`{ reason }`) |

### Admin (`/api/admin`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/verifications` | 🔑 | Pending ICAI verifications |
| `GET` | `/api/admin/verifications/:userId` | 🔑 | Verification detail (decrypted ICAI#) |
| `POST` | `/api/admin/verifications/:userId/review` | 🔑 | Approve/reject (`{ status, reason? }`) |
| `GET` | `/api/admin/reports` | 🔑 | List reports (query: status) |
| `POST` | `/api/admin/reports/:reportId/review` | 🔑 | Action on report (`{ action, adminNote? }`) |
| `GET` | `/api/admin/flagged-users` | 🔑 | List auto-flagged users |
| `PUT` | `/api/admin/users/:userId/status` | 🔑 | Update user account status |
| `GET` | `/api/admin/logs` | 🔑 | Admin audit logs |

> 🔑 = admin role required

### Notifications (`/api/notifications`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/notifications` | ✓ | Get notifications (query: unreadOnly, page, limit) |
| `PUT` | `/api/notifications/:notificationId/read` | ✓ | Mark single as read |
| `PUT` | `/api/notifications/read-all` | ✓ | Mark all as read |

---

## Security Features

- **Password policy**: min 8 chars, 1 number, 1 special char (enforced server-side)
- **JWT access/refresh**: 15min access, 7-day refresh with rotation + revocation
- **Account lockout**: configurable max attempts + cooldown period
- **Rate limiting**: strict on auth routes (5/15min), general on all routes (100/15min)
- **CORS**: locked to frontend origin (no wildcard)
- **Input sanitisation**: NoSQL injection (`express-mongo-sanitize`) + XSS (`xss-clean`)
- **File uploads**: restricted to JPG/PNG/PDF, max 5MB, UUID filenames
- **Sensitive fields**: `select: false` in Mongoose schemas, never exposed in responses
- **ICAI numbers**: AES-256-CBC encrypted at rest
- **Helmet**: secure HTTP headers
- **Centralised error handler**: hides stack traces in production
- **Logging**: Winston with sensitive-data redaction

---

## Creating an Admin User

Currently, admin users are created by directly updating a user's role in MongoDB:

```js
// In MongoDB shell or a seed script:
db.users.updateOne(
  { email: "admin@caconnect.com" },
  { $set: { role: "admin" } }
)
```

---

## License

ISC
