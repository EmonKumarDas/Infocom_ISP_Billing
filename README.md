Frontend
HTML & Vanilla JavaScript: For standard page structure and client-side logic (using the Fetch API instead of heavy frameworks).
Tailwind CSS (via CDN): For fast, utility-first styling. The UI utilizes custom configurations, CSS variables, and modern features like glassmorphism panels.
Google Fonts: Specifically the "Inter" font family.
Backend
Node.js: The Javascript runtime providing the environment.
Express.js (express): The core web framework acting as the web server and API routing backend.
SQLite3 (sqlite3): The lightweight relational database used to store users, billing history, and session data (

billing.db
 file).
Node-RouterOS (node-routeros): The library used to communicate with and control MikroTik routers via the MikroTik API.
Key Backend Utilities & Middleware
Authentication & Security:
bcryptjs (password hashing)
express-session (persisting user sessions)
helmet (adding secure HTTP headers)
express-rate-limit (safeguarding against brute-force attacks)
cors (handling Cross-Origin Resource Sharing)
Scheduling: node-cron (used to run background tasks like regularly expiring/suspending users).
Environment: dotenv (to load configuration variables from the 

.env
 file).
