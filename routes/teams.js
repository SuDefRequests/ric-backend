const express = require('express');
const router = express.Router();
const supabase = require('../db');
const requireAuth = require('../middleware/requireAuth');



// ── 1. List teams ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { competition_id } = req.query;
  try {
    let teamsQuery = supabase
      .from('teams')
      .select('*')
      .order('created_at', { ascending: false });

    if (competition_id) {
      teamsQuery = teamsQuery.eq('competition_id', competition_id);
    }

    const { data: teams, error: teamsError } = await teamsQuery;
    if (teamsError) return res.status(500).json({ error: teamsError.message });
    if (!teams || teams.length === 0) return res.json([]);

    const teamIds = teams.map((t) => t.id);

    const { data: membersData } = await supabase
      .from('team_members')
      .select('team_id, user_id')
      .in('team_id', teamIds);

    const userIds = [...new Set((membersData || []).map((m) => m.user_id))];

    let profilesMap = {};
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      (profilesData || []).forEach((p) => {
        profilesMap[p.id] = p.full_name || p.email;
      });
    }

    const membersByTeam = {};
    const memberIdsByTeam = {};

    (membersData || []).forEach((m) => {
      if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
      if (!memberIdsByTeam[m.team_id]) memberIdsByTeam[m.team_id] = [];

      membersByTeam[m.team_id].push(profilesMap[m.user_id] || 'Team Member');
      memberIdsByTeam[m.team_id].push(m.user_id);
    });

    const formattedTeams = teams.map((t) => ({
      ...t,
      competition_name: t.competition_name || 'Hackathon / SIH 2026',
      members_names: membersByTeam[t.id] || [],
      members_ids: memberIdsByTeam[t.id] || [],
    }));

    return res.json(formattedTeams);
  } catch (err) {
    console.error('List Error:', err);
    return res.status(500).json({ error: 'Could not load teams' });
  }
});


// ── 2. Create a recruiting team/squad ────────────────────────────
// POST /api/teams
router.post('/', requireAuth, async (req, res) => {
  const { name, needed_skills, target_size, competition_name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Team name is required.' });
  }

  try {
    const { data: comps } = await supabase.from('competitions').select('id').limit(1);
    const compId = comps && comps.length > 0 ? comps[0].id : null;

    const insertPayload = {
      name,
      created_by: req.user.id,
      needed_skills: Array.isArray(needed_skills) ? needed_skills : [],
      target_size: Number(target_size) || 6,
      status: 'open',
    };
    if (compId) insertPayload.competition_id = compId;

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert(insertPayload)
      .select()
      .single();

    if (teamError) {
      return res.status(400).json({ error: teamError.message });
    }

    // Add creator as initial member
    await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: req.user.id,
      competition_id: compId,
    });

    return res.status(201).json(team);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error creating team' });
  }
});
    

// ── Outgoing requests sent by the logged-in user ──────────────────
router.get('/my-requests', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch user's join requests
    const { data: requests, error: reqError } = await supabase
      .from('join_requests')
      .select('id, team_id, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (reqError) {
      console.error('Join requests error:', reqError.message);
      return res.json([]);
    }

    if (!requests || requests.length === 0) {
      return res.json([]);
    }

    // 2. Fetch all teams corresponding to these requests
    const teamIds = [...new Set(requests.map((r) => r.team_id).filter(Boolean))];
    
    let teamsMap = {};
    if (teamIds.length > 0) {
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .in('id', teamIds);

      if (!teamsError && teamsData) {
        teamsData.forEach((t) => {
          teamsMap[String(t.id)] = t;
        });
      }
    }

    // 3. Map actual team details to each request
    const formatted = requests.map((r) => {
      const matchedTeam = teamsMap[String(r.team_id)];
      return {
        id: r.id,
        team_id: r.team_id,
        status: r.status,
        created_at: r.created_at,
        teams: {
          name: matchedTeam?.name || matchedTeam?.team_name || 'Recruiting Squad',
          competition_name: matchedTeam?.competition_name || 'SIH 2026',
        },
      };
    });

    return res.json(formatted);
  } catch (err) {
    console.error('Fetch my requests error:', err);
    return res.json([]);
  }
});

// ── 3. Update squad status / needed skills (Creator only) ─────────
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status, needed_skills, name } = req.body;

  try {
    const { data: team } = await supabase
      .from('teams')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();

    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: Only the creator can edit this team' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (needed_skills !== undefined) updates.needed_skills = needed_skills;
    if (name !== undefined) updates.name = name;

    const { data, error } = await supabase
      .from('teams')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Could not update team' });
  }
});

// ── 4. Request to join ───────────────────────────────────────────
router.post('/:id/request', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: team } = await supabase
      .from('teams')
      .select('status, competition_id')
      .eq('id', id)
      .maybeSingle();

    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.status !== 'open') {
      return res.status(400).json({ error: 'This squad is closed or locked for new members.' });
    }

    const { error: insertError } = await supabase.from('join_requests').insert({
      team_id: id,
      user_id: req.user.id,
      competition_id: team.competition_id,
      status: 'pending',
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({ error: 'You already requested to join this team.' });
      }
      return res.status(400).json({ error: insertError.message });
    }

    return res.status(201).json({ status: 'requested' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send join request' });
  }
});

// ── 5. View pending requests ─────────────────────────────────────
router.get('/:id/requests', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: team } = await supabase
      .from('teams')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();

    if (!team || team.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data: requests, error } = await supabase
      .from('join_requests')
      .select('id, status, created_at, user_id')
      .eq('team_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const userIds = (requests || []).map((r) => r.user_id);
    let profilesMap = {};

    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      (profilesData || []).forEach((p) => {
        profilesMap[p.id] = p;
      });
    }

    const formatted = (requests || []).map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      email: profilesMap[r.user_id]?.full_name || profilesMap[r.user_id]?.email || 'Applicant',
      details: profilesMap[r.user_id] || null,
    }));

    return res.json(formatted);
  } catch (err) {
    return res.status(500).json({ error: 'Could not load requests' });
  }
});

// ── 6. Accept / Reject Request ───────────────────────────────────
router.post('/:id/requests/:requestId/:decision', requireAuth, async (req, res) => {
  const { id, requestId, decision } = req.params;
  if (!['accept', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision' });
  }

  try {
    const { data: team } = await supabase
      .from('teams')
      .select('created_by, competition_id')
      .eq('id', id)
      .maybeSingle();

    if (!team || team.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data: joinReq } = await supabase
      .from('join_requests')
      .select('*')
      .eq('id', requestId)
      .eq('team_id', id)
      .eq('status', 'pending')
      .maybeSingle();

    if (!joinReq) return res.status(404).json({ error: 'Request not found' });

    if (decision === 'accept') {
      await supabase.from('team_members').insert({
        team_id: id,
        user_id: joinReq.user_id,
        competition_id: team.competition_id,
      });
    }

    await supabase
      .from('join_requests')
      .update({ status: decision === 'accept' ? 'accepted' : 'rejected' })
      .eq('id', requestId);

    return res.json({ status: decision });
  } catch (err) {
    return res.status(500).json({ error: 'Could not process request' });
  }
});

// ── 7. Delete Team ───────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: team } = await supabase
      .from('teams')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();

    if (!team || team.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await supabase.from('join_requests').delete().eq('team_id', id);
    await supabase.from('team_members').delete().eq('team_id', id);
    await supabase.from('teams').delete().eq('id', id);

    return res.json({ status: 'deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete team' });
  }
});

module.exports = router;