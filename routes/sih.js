const express = require('express');
const router = express.Router();
const supabase = require('../db');
const requireAuth = require('../middleware/requireAuth');

// 1. Submit a 6-Member SIH Team
router.post('/register', requireAuth, async (req, res) => {
  try {
    const { teamDetails, members } = req.body;
    const userId = req.user.id;

    if (!teamDetails || !teamDetails.teamName || !teamDetails.department || !teamDetails.psId) {
      return res.status(400).json({ error: 'Missing required team details.' });
    }

    // Validation: Exactly 6 members
    if (!members || !Array.isArray(members) || members.length !== 6) {
      return res.status(400).json({ error: 'Team must have exactly 6 members.' });
    }

    // Normalize member fields safely to catch any frontend key variant
    const normalizedMembers = members.map((m, index) => {
      const cleanPhone = (m.phone || m.mobile_no || m.contact || m.mobile || '').toString().trim();
      const cleanEmail = (m.email || '').toString().trim().toLowerCase();
      const cleanName = (m.name || '').toString().trim();
      const cleanRoll = (m.roll_no || m.rollNo || '').toString().trim();

      return {
        ...m,
        s_no: index + 1,
        is_leader: Boolean(m.is_leader || m.isLeader || index === 0),
        name: cleanName,
        branch: m.branch || teamDetails.department,
        year: m.year || '1st Year',
        roll_no: cleanRoll,
        email: cleanEmail,
        gender: m.gender || 'Male',
        phone: cleanPhone,
        contact: cleanPhone,
      };
    });

    // Extract values for duplicate validation
    const emails = normalizedMembers.map((m) => m.email).filter(Boolean);
    const phones = normalizedMembers.map((m) => m.phone).filter(Boolean);
    const names = normalizedMembers.map((m) => m.name.toLowerCase()).filter(Boolean);

    // Verify all 6 items exist before duplicate check
    if (emails.length !== 6 || phones.length !== 6 || names.length !== 6) {
      return res.status(400).json({
        error: 'Please ensure all 6 members have complete Name, Email, and 10-digit Mobile numbers filled out.',
      });
    }

    const hasDup = (arr) => new Set(arr).size !== arr.length;

    if (hasDup(emails)) {
      return res.status(400).json({ error: 'Duplicate email detected. All 6 members must have unique emails.' });
    }
    if (hasDup(phones)) {
      return res.status(400).json({ error: 'Duplicate phone number detected. All 6 members must have unique mobile numbers.' });
    }
    if (hasDup(names)) {
      return res.status(400).json({ error: 'Duplicate member name detected. All 6 members must be distinct individuals.' });
    }

    // 1. Insert SIH Submission Record
    const { data: teamData, error: teamError } = await supabase
      .from('sih_submissions')
      .insert({
        user_id: userId,
        department: teamDetails.department,
        team_name: teamDetails.teamName.trim(),
        edition: teamDetails.edition || 'Software Edition',
        ps_id: teamDetails.psId.trim(),
        ps_title: teamDetails.psTitle.trim(),
        category: teamDetails.category || 'Software',
        mentor_name: teamDetails.mentorName?.trim() || null,
        mentor_contact: teamDetails.mentorContact?.trim() || null,
        mentor_email: teamDetails.mentorEmail?.trim() || null,
      })
      .select()
      .single();

    if (teamError) {
      return res.status(400).json({ error: teamError.message });
    }

    // 2. Format and Bulk-Insert All 6 Members
    const membersPayload = normalizedMembers.map((m) => ({
      submission_id: teamData.id,
      s_no: m.s_no,
      is_leader: m.is_leader,
      name: m.name,
      branch: m.branch,
      year: m.year,
      roll_no: m.roll_no,
      email: m.email,
      gender: m.gender,
      contact: m.phone,
    }));

    const { error: membersError } = await supabase
      .from('sih_members')
      .insert(membersPayload);

    if (membersError) {
      // Rollback the submission if member insertion fails
      await supabase.from('sih_submissions').delete().eq('id', teamData.id);
      return res.status(400).json({ error: `Member registration failed: ${membersError.message}` });
    }

    return res.status(201).json({
      message: 'SIH registration submitted successfully.',
      submissionId: teamData.id,
    });
  } catch (err) {
    console.error('SIH Registration Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Fetch Confirmed Submissions for Registered Teams Page (Hides PS Details)
router.get('/submissions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sih_submissions')
      .select(`
        id,
        team_name,
        department,
        edition,
        category,
        created_at,
        sih_members (
          s_no,
          is_leader,
          name,
          branch,
          year
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (err) {
    console.error('Fetch SIH Submissions Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;