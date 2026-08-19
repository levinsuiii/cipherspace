ALTER TABLE workspaces
  RENAME COLUMN owner_user_id TO creator_user_id;

ALTER TABLE workspace_members
  DROP CONSTRAINT workspace_members_role_valid;

UPDATE workspace_members
SET role = 'editor'
WHERE role = 'member';

ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_role_valid
    CHECK (role IN ('owner', 'editor', 'viewer'));
