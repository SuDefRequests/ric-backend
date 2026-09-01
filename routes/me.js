const express = require('express');
const router = express.Router();
const supabase = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/me
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ profile: profile || null });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/me - Upsert User Profile
// POST /api/me - Upsert User Profile
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { full_name, branch, year, roll_no, mobile_no, phone, pitch, tags, skills, is_public } = req.body;

    let tagsArray = [];
    if (Array.isArray(tags)) {
      tagsArray = tags;
    } else if (typeof tags === 'string') {
      tagsArray = tags.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    } else if (typeof skills === 'string') {
      tagsArray = skills.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    }

    const contactVal = mobile_no || phone || null;

    const payload = {
      id: userId,
      email: userEmail,
      full_name: full_name || null,
      branch: branch || null,
      year: year || null,
      roll_no: roll_no || null,
      phone: contactVal,
      mobile_no: contactVal,
      pitch: pitch || null,
      tags: tagsArray,
      is_public: is_public !== undefined ? Boolean(is_public) : true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload)
      .select()
      .single();

    if (error) {
      console.error('Profile upsert error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.json({ profile: data });
  } catch (err) {
    console.error('Server error in POST /api/me:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;