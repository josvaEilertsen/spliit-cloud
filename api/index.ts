import { handle } from 'hono/vercel'

import { app } from '@spliit/api/app'

export default handle(app)
