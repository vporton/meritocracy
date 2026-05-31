# Meritocracy App

**Don't forget to run `git config core.hooksPath git_hooks`, if you are a maintainer!**

(For the most functioning version, you may see the `stable` branch.)

"Meritocracy" (in full: "AI Internet-Meritocracy", or AIIM) is an app that gathers crypto donations and distributes them among scientists, free software developers, and science marketers/popularizers whose salaries are based on their impact in promoting science (especially under-represented areas and discoveries).

See [the site](https://science-dao.org/meritocracy/) for more information.

The app decides how much to pay each employee (registered user) simply by asking an AI (not by, for example, quadratic voting of users).

Actually, this "meritocracy" is quite capitalistic, as it hinted to me (the author of the app) that I am probably worth ~$1B/year.

It is a full-stack application built with Node.js, React, and Prisma ORM.

## 🚀 Tech Stack

### Backend
- **Node.js** with **Express.js** - Fast, unopinionated web framework
- **Prisma ORM** - Modern database toolkit with type safety
- **Database Support**: MySQL, PostgreSQL, SQLite
- **CORS** enabled for cross-origin requests
- **Helmet** for security headers
- **Morgan** for HTTP request logging

### Frontend
- **React 18** - Modern React with hooks
- **Vite** - Lightning fast build tool
- **React Router** - Declarative routing
- **Axios** - Promise-based HTTP client
- **Modern CSS** with dark/light theme support

## 🌐 Supported Gas Token Networks

The automated distribution service currently supports native gas tokens on:
- Ethereum family networks (Mainnet, Polygon, Arbitrum, Optimism, Base, Celo, Sepolia, Localhost)
- Solana (SOL)
- Bitcoin (BTC)
- Polkadot (DOT)
- Cosmos Hub (ATOM)
- Stellar (XLM)
- Internet Computer (ICP)

It also supports ICP ICRC-1 assets with fixed transfer fees that behave operationally like gas-token distributions:
- ckBTC
- ckETH
- ckUSDT
- ckUSDC
- ckEURC

## 📁 Project Structure

```
meritocracy/
├── backend/                 # Node.js API server
│   ├── src/
│   │   ├── index.js        # Express server setup
│   │   └── routes/         # API route handlers
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   └── seed.js         # Database seeding
│   ├── package.json
│   └── env.example         # Environment variables template
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API service layer
│   │   └── main.jsx        # React entry point
│   ├── package.json
│   └── env.example         # Environment variables template
└── package.json            # Root package.json with scripts
```

## 🛠️ Quick Start

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/vporton/meritocracy.git
cd meritocracy
```

### 2. Install Dependencies
```bash
# Set NPM version
nvm use v22.1.0

# Install base dependencies
npm run install
```

### 3. Environment Setup

#### Backend Environment
```bash
cd backend
cp env.example .env
```

Edit `.env` file and configure your database:

**SQLite (Default - recommended for development):**
```env
DATABASE_URL="file:./dev.db"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

**PostgreSQL:**
```env
DATABASE_URL="postgresql://username:password@localhost:5432/meritocracy?schema=public"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

**MySQL:**
```env
DATABASE_URL="mysql://username:password@localhost:3306/meritocracy"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

#### Frontend Environment
```bash
cd frontend
cp env.example .env
```

Edit `.env` file:
```env
VITE_API_URL=http://localhost:3001
```

### 4. Database Setup
```bash
# Setup database and seed with sample data
npm run db:setup
```

This command will:
- Generate Prisma client
- Create/update database schema
- Seed the database with sample users and posts

### 5. Start Development Servers
```bash
# Start both backend and frontend concurrently
npm run dev

# Or start separately:
npm run dev-backend  # Backend on http://localhost:3001
npm run dev-frontend # Frontend on http://localhost:5173
```

## 🗄️ Database Configuration

### Switching Between Databases

1. **Update Prisma Schema** (`backend/prisma/schema.prisma`):
   ```prisma
   datasource db {
     provider = "sqlite"      // Change to "postgresql" or "mysql"
     url      = env("DATABASE_URL")
   }
   ```

2. **Update Environment Variables** (`.env`):
   - Update `DATABASE_URL` with your database connection string

3. **Regenerate Prisma Client**:
   ```bash
   cd backend
   npx prisma generate
   npx prisma db push
   ```

### Database Scripts
```bash
# Reset database (caution: deletes all data)
npm run db:reset

# Open Prisma Studio (database GUI)
cd backend && npx prisma studio

# Generate Prisma client only
cd backend && npx prisma generate

# Apply schema changes
cd backend && npx prisma db push

# Create and apply migration
cd backend && npx prisma migrate dev
```

## 🎯 API Endpoints

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Example API Usage
```javascript
// Create a new user
POST /api/users
{
  "name": "John Doe",
  "email": "john@example.com"
}

## 🎨 Features

### Backend Features
- RESTful API design
- Database-agnostic ORM (Prisma)
- Input validation and error handling
- CORS configuration
- Security headers (Helmet)
- Request logging (Morgan)
- Environment-based configuration

### Frontend Features
- Modern React with hooks
- Responsive design with dark/light theme
- Client-side routing (React Router)
- API integration with error handling
- Real-time UI updates
- Form validation
- Loading states and user feedback

## 🔧 Development

### Available Scripts

**Root level:**
- `npm run install-all` - Install all dependencies
- `npm run dev` - Start both servers in development mode
- `npm run build` - Build both applications for production
- `npm run start` - Start both applications in production mode

**Backend:**
- `npm run dev` - Start development server with nodemon
- `npm run start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Create and apply migration
- `npm run db:studio` - Open Prisma Studio
- `npm run db:seed` - Seed database with sample data

**Frontend:**
- `npm run dev` - Start Vite development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Code Structure Guidelines

**Backend:**
- Place route handlers in `src/routes/`
- Use Prisma client for database operations
- Follow RESTful API conventions
- Include proper error handling

**Frontend:**
- Components in `src/components/`
- Pages in `src/pages/`
- API calls in `src/services/`
- Follow React best practices and hooks

## 📦 Production Deployment

### Backend Deployment
1. Set environment variables for production
2. Ensure database is accessible
3. Run `npx prisma generate && npx prisma db push`
4. Start with `npm start`

### Frontend Deployment
1. Build the application: `npm run build`
2. Deploy the `dist/` folder to your hosting service
3. Configure environment variables for production API URL

### Environment Variables for Production
- Update `DATABASE_URL` with production database
- Set `NODE_ENV=production`
- Update `FRONTEND_URL` with `https://merit.science-dao.org` or `https://merit-staging.science-dao.org`
- Update `API_URL` with `https://api.merit.science-dao.org` or `https://api.merit-staging.science-dao.org`
- Update `VITE_FRONTEND_URL` and `VITE_API_URL` to match the HTTPS hosts used in production

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature-name`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔍 Troubleshooting

### Common Issues

**Database Connection Issues:**
- Verify `DATABASE_URL` in `.env` file
- Ensure database server is running (for PostgreSQL/MySQL)
- Check network connectivity and credentials

**Host Configuration:**
- Production frontend host: `https://merit.science-dao.org`
- Production API host: `https://api.merit.science-dao.org`
- Staging frontend host: `https://merit-staging.science-dao.org`
- Staging API host: `https://api.merit-staging.science-dao.org`

**Prisma Issues:**
- Run `npx prisma generate` after schema changes
- Delete `node_modules` and reinstall if client issues persist
- Check Prisma documentation for database-specific configurations

**Build Issues:**
- Clear node_modules and package-lock.json, then reinstall
- Check for version compatibility issues
- Ensure all environment variables are set correctly

For more help, check the documentation of the individual technologies or create an issue in the repository.
