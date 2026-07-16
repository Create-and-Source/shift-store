import { roleFromReq } from '../_lib/adminRole.js'

// Login check: which admin role does this key belong to?
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const role = roleFromReq(req)
  if (!role) return res.status(401).json({ error: 'Unauthorized' })
  return res.status(200).json({ role })
}
