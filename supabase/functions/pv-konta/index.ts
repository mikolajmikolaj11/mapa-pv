// Mapa PV – zarządzanie kontami z aplikacji (tylko administrator).
// Akcje: utworz (nowe konto), haslo (nowe hasło), blokuj (zablokuj / odblokuj).
// Klucz administracyjny jest tylko tutaj, na serwerze Supabase – nigdy w plikach aplikacji.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys.default) return keys.default;
  } catch (_) { /* brak nowych kluczy */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, key = secretKey();
    if (!key) return json({ error: 'Funkcja nie ma dostępu do klucza administracyjnego Supabase.' }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // kto woła? musi być zalogowanym, niezablokowanym administratorem
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: 'Zaloguj się ponownie.' }, 401);
    const { data: me } = await admin.from('profiles').select('rola, zablokowany').eq('id', who.user.id).single();
    if (!me || me.rola !== 'admin' || me.zablokowany) return json({ error: 'Tylko administrator może zarządzać kontami.' }, 403);

    const b = await req.json();
    const role = ['admin', 'manager', 'handlowiec'];

    if (b.akcja === 'utworz') {
      const email = String(b.email || '').trim().toLowerCase(), haslo = String(b.haslo || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Wpisz poprawny adres e-mail.' }, 400);
      if (haslo.length < 8) return json({ error: 'Hasło musi mieć co najmniej 8 znaków.' }, 400);
      const rola = role.includes(b.rola) ? b.rola : 'handlowiec';
      const { data, error } = await admin.auth.admin.createUser({ email, password: haslo, email_confirm: true });
      if (error) return json({ error: /already/i.test(error.message) ? 'Konto z tym adresem już istnieje.' : error.message }, 400);
      const id = data.user.id;
      const { error: pe } = await admin.from('profiles').upsert({
        id, email, imie: String(b.imie || '').trim() || null, rola,
        manager_id: rola === 'handlowiec' && b.manager_id ? b.manager_id : null,
      });
      if (pe) return json({ error: 'Konto powstało, ale nie zapisano profilu: ' + pe.message }, 500);
      return json({ ok: true, id });
    }

    if (b.akcja === 'haslo') {
      const haslo = String(b.haslo || '');
      if (haslo.length < 8) return json({ error: 'Hasło musi mieć co najmniej 8 znaków.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: haslo });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (b.akcja === 'blokuj') {
      if (b.user_id === who.user.id) return json({ error: 'Nie możesz zablokować własnego konta.' }, 400);
      const blok = !!b.zablokuj;
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: blok ? '876000h' : 'none' });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ zablokowany: blok }).eq('id', b.user_id);
      return json({ ok: true });
    }

    return json({ error: 'Nieznana akcja.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
