<script setup lang="ts">
// Beheer › Mensen (#70): every number with its name and where it's listed, to see who's forgotten, listed twice or still there.
// Only to look at; changes stay on the page of the post, team or core team. The name is shared everywhere, so that can change here.
import { computed, onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { formatPhone, telHref, type PeopleOverview, type PersonLink } from '@ehbo/shared';
import { api } from '../../api.ts';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useSave } from '../../composables/useSave.ts';

const overview = ref<PeopleOverview | null>(null);
const loadError = ref('');
const query = ref('');
/** The person whose name is being changed, and the new name. */
const editing = ref<string | null>(null);
const name = ref('');
const { busy, error, run } = useSave();

onMounted(async () => {
  try {
    overview.value = await api<PeopleOverview>('/api/admin/people');
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '').replace(/^0/, '');
  return (overview.value?.people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)));
});

const linkTo = (link: PersonLink): RouteLocationRaw => {
  switch (link.kind) {
    case 'post': return { name: 'admin-post', params: { id: link.id! } };
    case 'team': return { name: 'admin-team', params: { id: link.id! } };
    case 'core': return { name: 'admin-core-team' };
    default: return { name: 'admin-admins' };
  }
};

function edit(phone: string, current: string) {
  editing.value = phone;
  name.value = current;
}

async function saveName() {
  const phone = editing.value;
  if (!phone) return;
  if (await run(async () => {
    overview.value = await api<PeopleOverview>(`/api/admin/people/${encodeURIComponent(phone)}`, { method: 'PUT', body: { name: name.value } });
  })) editing.value = null;
}
</script>

<template>
  <AdminPage title="Mensen" eyebrow="Beheer" :back="{ name: 'admin' }">
    <p v-if="loadError" class="note warn" role="alert">{{ loadError }}</p>
    <p v-else-if="!overview" class="small">Laden…</p>
    <template v-else>
      <label class="search">
        <Icon name="search" :size="18" />
        <input v-model="query" class="input" type="search" placeholder="Zoek op naam of nummer" aria-label="Zoek een persoon">
      </label>

      <div class="list">
        <div v-for="p in shown" :key="p.phone" class="list-row person" :class="{ attention: p.problems.length }">
          <span class="stack grow who">
            <template v-if="editing === p.phone">
              <input v-model="name" class="input" :aria-label="`Naam van ${formatPhone(p.phone)}`" maxlength="80" @keyup.enter="saveName">
              <span class="edit-actions">
                <button class="btn link" :disabled="busy" @click="saveName">Opslaan</button>
                <button class="btn link" :disabled="busy" @click="editing = null">Annuleren</button>
              </span>
            </template>
            <button v-else class="name" :aria-label="`Naam wijzigen: ${p.name || formatPhone(p.phone)}`" @click="edit(p.phone, p.name)">
              {{ p.name || 'Geen naam' }}<Icon name="settings" :size="14" />
            </button>
            <span class="mono small">{{ formatPhone(p.phone) }}</span>
            <span class="tags">
              <RouterLink v-for="l in p.links" :key="`${l.kind}-${l.id}-${l.label}`" :to="linkTo(l)" class="tag">{{ l.label }}</RouterLink>
            </span>
            <span class="small state">{{ p.loggedIn ? 'Aangemeld' : 'Niet aangemeld' }} · {{ p.push ? 'meldingen aan' : 'geen meldingen' }}</span>
            <span v-for="problem in p.problems" :key="problem" class="small warn-text">{{ problem }}</span>
          </span>
          <a :href="telHref(p.phone)" class="round" :aria-label="`Bel ${p.name || formatPhone(p.phone)}`"><Icon name="phone" :size="20" /></a>
        </div>
        <p v-if="!shown.length" class="small empty">Niemand gevonden.</p>
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>

      <section v-if="overview.gaps.length" class="stack gap-6">
        <span class="section-title">Nog in te vullen</span>
        <div class="list">
          <RouterLink v-for="g in overview.gaps" :key="`${g.kind}-${g.id}-${g.label}`" :to="linkTo(g)" class="list-row gap">
            <span class="grow">{{ g.label }}</span><Icon name="forward" :size="18" />
          </RouterLink>
        </div>
      </section>

      <a href="/api/admin/people.csv" class="btn" download>CSV-export</a>
      <span class="small">Aanpassen doe je op de pagina van de locatie, eenheid of het kernteam. De naam geldt overal en kun je hier wijzigen.</span>
    </template>
  </AdminPage>
</template>

<style scoped>
.search { position: relative; display: block; color: var(--muted); }
.search svg { position: absolute; left: 12px; top: 13px; }
.search .input { padding-left: 38px; }
.person { align-items: flex-start; gap: 12px; padding-top: 12px; padding-bottom: 12px; }
.person.attention { box-shadow: inset 3px 0 0 var(--warn-line); }
.who { gap: 4px; min-width: 0; }
.name { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0; border: 0; background: none; color: var(--ink); font: 700 16px var(--sans); text-align: left; cursor: pointer; }
.name svg { color: var(--muted); }
.edit-actions { display: flex; gap: 16px; }
.edit-actions .btn { min-height: 44px; padding: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.tag { padding: 4px 10px; border-radius: 999px; background: var(--soft); color: var(--ink); font-size: 12px; font-weight: 600; text-decoration: none; }
.state { color: var(--muted); }
.warn-text { color: var(--warn); font-weight: 600; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.gap { min-height: 48px; font-size: 14px; }
.empty { padding: 12px 14px; }
</style>
