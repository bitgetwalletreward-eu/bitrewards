# Deploying to Vercel

Your BitRewards app is now configured for Vercel serverless deployment! Here's how to deploy:

## Prerequisites

1. Install the Vercel CLI:

   ```bash
   npm install -g vercel
   ```

2. Make sure you have a [Vercel account](https://vercel.com)

## Environment Variables

Before deploying, set your environment variables in Vercel:

1. In your Vercel project settings, add these environment variables:
   - `MONGODB_URI` - Your MongoDB connection string
   - `SESSION_SECRET` - A secret key for sessions (generate a random string)
   - `TELEGRAM_USERNAME` - Your Telegram username
   - `ADMIN_USER` - Default admin username (optional)
   - `ADMIN_PASS` - Default admin password (optional)
   - `NODE_ENV` - Set to `production`

## Deployment Steps

### Option 1: Using Vercel CLI

```bash
# Login to Vercel
vercel login

# Deploy
vercel

# For production deployment
vercel --prod
```

### Option 2: Using Git Integration

1. Push your code to GitHub/GitLab/Bitbucket
2. Connect your repository to Vercel at https://vercel.com/new
3. Set environment variables in project settings
4. Vercel will auto-deploy on git push

## Key Changes Made

✅ **api/index.js** - Express app exported as serverless handler
✅ **vercel.json** - Vercel configuration  
✅ **package.json** - Updated with Node 18.x and connect-mongo
✅ **.vercelignore** - Files to exclude from deployment
✅ **Session Storage** - Now uses MongoDB (connect-mongo) instead of memory

## Important Notes

- Your app now uses **serverless functions** - perfect for Vercel's architecture
- Sessions are stored in MongoDB (not memory) - persists across requests
- Static files in `/public` and EJS views in `/views` are served correctly
- No changes needed to your code logic - it works the same way!

## Database

Make sure your MongoDB Atlas cluster:

- Allows connections from Vercel's IP ranges
- Or use: `Network Access -> 0.0.0.0/0` (less secure, use IP whitelist in production)

## Testing Locally

```bash
# Install dependencies
npm install

# Set environment variables
export MONGODB_URI="your_mongodb_uri"
export SESSION_SECRET="your_secret"
export TELEGRAM_USERNAME="your_telegram"

# Run locally
npm start

# Or use Vercel CLI locally
vercel dev
```

## Troubleshooting

- **Session not persisting?** Check MongoDB connection and connect-mongo configuration
- **Images not loading?** Ensure `/public` files are part of deployment
- **Views not rendering?** Check that view engine path is correct in api/index.js
