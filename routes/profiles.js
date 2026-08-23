const express = require('express');
const router = express.Router();
const supabase = require('../db');
const requireAuth = require('../middleware/requireAuth');

// ── GET all profiles (Directory Page) ──────────────────────────
router.get('/', async (req, res) => {
  const { q } = req.query;
  try {
    let query = supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (q) {
      query = query.or(`full_name.ilike.%${q}%,branch.ilike.%${q}%,pitch.ilike.%${q}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase fetch profiles error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (err) {
    console.error('Server error in GET /api/profiles:', err);
    return res.status(500).json({ error: 'Failed to load profiles' });
  }
});

// ── GET current user's profile ─────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      console.error('Supabase fetch my profile error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data || null);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load your profile' });
  }
});

// ── POST: Upsert Profile ───────────────────────────────────────
// ── POST: Upsert Profile ───────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { full_name, branch, year, roll_no, mobile_no, phone, pitch, tags, skills } = req.body;

  let tagsArray = [];
  if (Array.isArray(tags)) {
    tagsArray = tags;
  } else if (typeof tags === 'string') {
    tagsArray = tags.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  } else if (typeof skills === 'string') {
    tagsArray = skills.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: req.user.id,
        full_name,
        branch,
        year,
        roll_no: roll_no || null,
        phone: phone || mobile_no || null,
        pitch,
        tags: tagsArray,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase profile upsert error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('Profile Save Error:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

// ── DELETE user's profile ──────────────────────────────────────
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', req.user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ status: 'deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// ── Reveal contact info ─────────────────────────────────────────
router.get('/:id/reveal', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email, mobile_no, phone')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reveal contact' });
  }
});

module.exports = router;