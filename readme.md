# Deploying to DigitalOcean Functions

### 1. Authenticate `doctl`

First, authenticate `doctl` with your DigitalOcean account:

doctl auth init

### 2. Deploy code

doctl serverless deploy sitemap-functions

### 3. Update environment variables in DO 

After each deployment we need to update digital ocean app with the correct env variables to be used:

DB_NAME=
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=


