# Architecture & Design Document

## Schema Reasoning

### Why This Data Model?

The schema follows a hierarchical organization → workflow → steps pattern that mirrors real-world workflow management:

1. **Organizations as the Root**
   - Multi-tenancy is built-in from the start
   - Quota tracking at the org level prevents runaway costs
   - All data scoped to orgs enables complete isolation

2. **Org Members as the Permission Join**
   - Rather than embedding roles in users, we use a join table
   - This allows users to belong to multiple orgs with different roles
   - Role changes are immediate (no token refresh needed)

3. **Workflows as Containers**
   - Workflows group related automation logic
   - Separating workflows from steps allows versioning and cloning later
   - `is_active` flag enables safe testing without deletion

4. **Steps with JSONB Config**
   - Using JSONB for config keeps the schema flexible
   - Different step types need different configuration shapes
   - No need for separate tables per step type

5. **Triggers Decoupled from Runs**
   - A workflow can have multiple triggers (cron + webhook + manual)
   - Triggers are configuration; runs are execution records
   - Each run records which trigger started it

6. **Two-Level Run Tracking**
   - `workflow_runs` tracks overall execution status
   - `step_runs` tracks individual step progress
   - This enables live progress updates via subscriptions

## Two-Layer Permission System

### Why Two Layers?

Hasura's row-level security (RLS) handles **data access** but not **business logic**. Some operations require checking conditions that span multiple tables or involve non-database state (like comparing a user's role against a step's required role).

### Layer 1: Hasura Permissions (Data Access)

Every table has permissions that:
- Filter rows to the user's org membership
- Restrict writes based on role (owner vs editor vs viewer)

**Example: Workflow Read Permission**
```yaml
filter:
  organization:
    members:
      user_id:
        _eq: X-Hasura-User-Id
```

This ensures an Org B user can never see Org A's workflows, even if they guess the UUID.

**Role-Based Write Permissions:**
- `owner` + `editor` can create/edit workflows and steps
- Only `owner` can delete workflows
- `viewer` cannot modify anything

### Layer 2: Action Handler Checks (Business Logic)

The serverless functions perform additional validation:

**In `triggerWorkflowRun`:**
1. Verify user is owner/editor in the workflow's org
2. Check org quota isn't exhausted
3. If workflow has owner-only step types, log but allow (editor can run, just not create)

**In `approveStep`:**
1. Verify step is actually in `awaiting_approval` status
2. Check user's role matches step's `required_role` config
3. An editor cannot approve a step that requires owner approval

**Why Can't This Be RLS?**
- Approval gate requires comparing runtime config (`required_role`) against the approver's role
- Quota checking requires reading and updating org state atomically
- These are mid-execution decisions, not simple CRUD operations

### Restricted Operations (Owner-Only)

Some step and trigger types can modify external systems or create security risks:

| Operation | Why Restricted |
|-----------|----------------|
| `db_write` step | Writes to database tables |
| `notify` step | Sends external communications |
| `webhook` trigger | Creates inbound endpoint |

These are enforced in the frontend (hiding UI options) and validated in action handlers.

## Approval Gate Implementation

### How Pause/Resume Works

1. **During Execution:**
   - Workflow engine iterates through steps in order
   - When it hits an `approval_gate` step:
     - Sets `step_runs.status` to `awaiting_approval`
     - Sets `workflow_runs.status` to `paused`
     - Returns immediately (doesn't block)

2. **User Sees Paused State:**
   - Subscription pushes updated step_runs to frontend
   - UI shows "Awaiting Approval" with Approve button

3. **On Approval:**
   - `approveStep` action is called
   - Handler checks approver's role against step config
   - If allowed:
     - Sets `step_runs.approved_by` and `approved_at`
     - Marks step as `completed`
     - **Continues executing remaining steps** from the handler
     - Updates workflow_run status based on final result

4. **Why Continue in Handler?**
   - We can't "resume" a function that already returned
   - The approval handler becomes the continuation
   - It picks up from where the workflow paused

### Data Flow

```
triggerWorkflowRun → execute step 1 → execute step 2 (approval_gate) → STOP
                                                    ↓
                                          set status = paused
                                          return to user
                                                    
... time passes, user clicks Approve ...

approveStep → verify role → mark approved → execute step 3 → execute step 4 → done
```

## Subscription Model

### Real-Time Updates

The frontend subscribes to `step_runs` filtered by `workflow_run_id`:

```graphql
subscription {
  step_runs(where: { workflow_run_id: { _eq: $id } }) {
    status
    output
    error
    step { name step_type }
  }
}
```

As the backend updates each step_run row, Hasura pushes changes to connected clients.

### Why Not Poll?

- Polling has latency (minimum interval between updates)
- Polling doesn't scale (N clients × M workflows = many queries)
- Subscriptions provide instant updates with minimal server load

## Retry Logic

External calls (`llm_call`, `http_request`) use exponential backoff:

```typescript
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await executeStep(...);
  if (result.success) return result;
  
  if (attempt < maxAttempts) {
    await sleep(1000 * Math.pow(2, attempt - 1));
    // 1s, 2s, 4s delays
  }
}
```

Non-retriable steps (conditional_branch, approval_gate) return immediately on failure.

## Quota Enforcement

1. **Before Run:** Check `quota_used < quota_limit`
2. **After Run:** Increment `quota_used` regardless of success/failure
3. **Periodic Reset:** When `quota_reset_at` passes, reset counter

This prevents:
- Users from exceeding their allowed runs
- Gaming the system by failing runs intentionally
- Accumulating unused quota (it resets, not rolls over)

## Security Considerations

1. **Cross-Org Isolation:** Every query filters by org membership
2. **Direct ID Attacks:** Even with a valid UUID, permissions block access
3. **Webhook Secrets:** Random UUIDs, validated before triggering
4. **No Admin Bypass:** User role is always `user`, not `admin`
5. **Input Sanitization:** Template variables in prompts don't execute code

## Scalability Notes

Current design supports:
- Many orgs with isolated data
- Concurrent workflow runs (each is independent)
- Multiple triggers per workflow

For production scale:
- Add connection pooling to nhost functions
- Consider queue-based execution for long workflows
- Add distributed locking for quota updates
- Cache org membership lookups
