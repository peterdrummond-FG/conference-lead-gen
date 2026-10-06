<template>
  <!-- State, District and School: the one place these three fields live. The attendee form
       (IntakeFormFields, which the Kiosk tab and the onboarding tour draw too), the lead
       editor (ContactEditor) and the merge dialog (DuplicateResolutionDialog) all render
       this, so a rule fixed here is fixed everywhere. What the fields do is in
       useInstitutionPicker (lists loaded once, filtered on the device) and
       utils/institutionPicker.ts (the matching rules, with tests). Look is the host's:
       `variant` picks the attendee form's borderless fields or the editor's outlined ones,
       and each field takes its host's layout class. -->
  <q-select
    :class="stateClass"
    :model-value="model.state"
    :options="stateOptions"
    option-label="name"
    v-bind="fieldProps"
    :label="stateLabel"
    @filter="filterStates"
    @update:model-value="picker.setState"
  />

  <!-- District comes first and stays the obvious step: enabled as soon as State is set,
       opens on that state's whole list, searchable from the first letter. -->
  <q-select
    :class="districtClass"
    :model-value="model.district"
    :options="picker.districtOpts.value"
    option-label="name"
    v-bind="fieldProps"
    new-value-mode="add-unique"
    :label="districtLabel"
    :disable="!model.state"
    :loading="picker.loadingDistricts.value"
    :hint="districtHint"
    @filter="picker.filterDistrict"
    @new-value="picker.onNewDistrict"
    @input-value="(v: string) => (picker.districtText.value = v)"
    @update:model-value="picker.setDistrict"
    @blur="picker.onDistrictBlur"
  >
    <template #option="scope">
      <q-item v-bind="scope.itemProps">
        <q-item-section>
          <q-item-label v-if="scope.opt.typed" class="ip-use">Use '{{ scope.opt.name }}'</q-item-label>
          <q-item-label v-else>{{ scope.opt.name }}</q-item-label>
          <q-item-label v-if="scope.opt.caption" caption>{{ scope.opt.caption }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
  </q-select>

  <!-- School is the quiet fallback to District: with a district it lists that district's
       schools; with none it just takes what is typed (and says the district will be looked
       up, only once they start typing). Usable as soon as State is set. -->
  <q-select
    :class="schoolClass"
    :model-value="model.school"
    :options="picker.schoolOpts.value"
    option-label="name"
    v-bind="fieldProps"
    new-value-mode="add-unique"
    :label="schoolLabel"
    :disable="!model.state"
    :loading="picker.loadingSchools.value"
    :hint="schoolHint"
    @filter="picker.filterSchool"
    @new-value="picker.onNewSchool"
    @input-value="(v: string) => (picker.schoolText.value = v)"
    @update:model-value="picker.setSchool"
    @blur="picker.onSchoolBlur"
  >
    <template #option="scope">
      <q-item v-bind="scope.itemProps">
        <q-item-section>
          <q-item-label v-if="scope.opt.typed" class="ip-use">Use '{{ scope.opt.name }}'</q-item-label>
          <q-item-label v-else>{{ scope.opt.name }}</q-item-label>
          <q-item-label v-if="scope.opt.caption" caption>{{ scope.opt.caption }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { filterStateOptions, US_STATES, type UsStateOption } from '@/constants/usStates';
import { useInstitutionPicker, type InstitutionModel } from '@/composables/useInstitutionPicker';

const props = withDefaults(defineProps<{
  // The host's reactive answers; the fields write straight into it.
  model: InstitutionModel;
  variant?: 'form' | 'editor';
  // The editor variant is dense; the merge dialog turns that off on a phone.
  dense?: boolean;
  stateLabel?: string;
  districtLabel?: string;
  schoolLabel?: string;
  stateClass?: string;
  districtClass?: string;
  schoolClass?: string;
  // The onboarding tour draws the attendee form with sample answers: no requests, no input.
  readonly?: boolean;
  // Show "Pick a state first" under a disabled field (the attendee form does; the editor's
  // fields are just greyed).
  hints?: boolean;
}>(), {
  variant: 'form',
  dense: true,
  stateLabel: 'State',
  districtLabel: 'School district',
  schoolLabel: 'School or campus',
  hints: false,
});

const picker = useInstitutionPicker(props.model, () => !props.readonly);

// Same flags the fields always had on each page.
const fieldProps = computed(() => ({
  readonly: props.readonly,
  'use-input': true,
  'fill-input': true,
  'hide-selected': true,
  'input-debounce': 0,
  ...(props.variant === 'editor' ? { dense: props.dense, outlined: true } : { borderless: true }),
}));

const stateOptions = ref<UsStateOption[]>(US_STATES);
function filterStates(val: string, update: (cb: () => void) => void) {
  update(() => { stateOptions.value = filterStateOptions(val); });
}

const districtHint = computed(() => {
  if (props.hints && !props.model.state) return 'Pick a state first';
  if (picker.districtsFailed.value && props.model.state) return "Couldn't load the list. Type your district and tap Use.";
  return undefined;
});
const schoolHint = computed(() => {
  if (props.hints && !props.model.state) return 'Pick a state first';
  if (picker.schoolsFailed.value && props.model.district?.id) return "Couldn't load the list. Type your school and tap Use.";
  return undefined;
});
</script>

<style scoped>
/* "Use '<typed>'" is the way past a list that doesn't have you, so it reads as an action. */
.ip-use { color: var(--q-primary); font-weight: 600; }
</style>
