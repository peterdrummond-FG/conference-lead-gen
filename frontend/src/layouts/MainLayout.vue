<template>
  <q-layout view="hHh lpr fFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>Conference Lead Intake</q-toolbar-title>
        <q-tabs align="right" indicator-color="white">
          <q-route-tab to="/setup" label="Setup" />
          <q-route-tab to="/intake" label="Intake" />
          <q-route-tab to="/review" label="Review" />
          <q-route-tab to="/export" label="Export" />
        </q-tabs>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
