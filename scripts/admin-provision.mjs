// Only generated IDs/hashes and a timestamp enter this operator SQL. No passwords
// or telephone aliases are created by the bootstrap tool.
export function adminProvisionSQL({ mode, userId, claimId, tokenHash, eventId, now }) {
  if (
    ![userId, claimId, eventId].every((id) => /^[0-9a-f-]{36}$/.test(id)) ||
    !/^[0-9a-f]{64}$/.test(tokenHash) ||
    !Number.isSafeInteger(now) ||
    !['bootstrap', 'recover'].includes(mode)
  )
    throw new Error('Invalid operator input.');
  const target =
    mode === 'bootstrap'
      ? `'${userId}'`
      : "(SELECT id FROM user WHERE role='admin' ORDER BY created_at, id LIMIT 1)";
  const create =
    mode === 'bootstrap'
      ? `INSERT INTO user (id,name,email,email_verified,created_at,updated_at,role,account_state)
    SELECT '${userId}','管理员',NULL,0,${now},${now},'admin','pending' WHERE NOT EXISTS (SELECT 1 FROM user WHERE role='admin');`
      : '';
  return `${create}
    UPDATE account_claim SET revoked_at=${now} WHERE user_id=${target} AND used_at IS NULL AND revoked_at IS NULL;
    INSERT INTO account_claim (id,user_id,token_hash,purpose,expires_at,created_at)
      SELECT '${claimId}',id,'${tokenHash}',CASE account_state WHEN 'active' THEN 'reset' ELSE 'activate' END,
        ${now}+CASE account_state WHEN 'active' THEN 3600000 ELSE 86400000 END,${now} FROM user WHERE id=${target};
    INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at)
      SELECT '${eventId}',NULL,user_id,'admin_${mode}_issued','本机受控管理员操作',${now} FROM account_claim WHERE id='${claimId}';
    SELECT id,purpose FROM account_claim WHERE id='${claimId}';`;
}
