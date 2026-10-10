import { BrowserRouter, Route, Routes } from 'react-router'
import { DataProvider } from '../data/DataProvider'
import { AgentProvider } from '../features/agent/AgentProvider'
import { ToastProvider } from '../features/toast/ToastProvider'
import { AppShell } from '../layout/AppShell'
import { CompaniesPage } from '../pages/CompaniesPage'
import { CompanyPage } from '../pages/company/CompanyPage'
import { MapPage } from '../pages/MapPage'
import { MethodologyPage } from '../pages/MethodologyPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { OpenDataPage } from '../pages/OpenDataPage'
import { OverviewPage } from '../pages/OverviewPage'
import { EnterprisePage } from '../pages/EnterprisePage'
import { RatingPage } from '../pages/RatingPage'
import { RegionPage } from '../pages/RegionPage'
import { VacanciesPage } from '../pages/VacanciesPage'
import { VacancyPage } from '../pages/VacancyPage'
import { FiltersProvider } from '../state/FiltersProvider'
import { IconSprite } from '../ui/IconSprite'

export function App() {
  return (
    <BrowserRouter>
      <IconSprite />
      <ToastProvider>
        <DataProvider>
          <FiltersProvider>
            <AgentProvider>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="map" element={<MapPage />} />
                  <Route path="companies" element={<CompaniesPage />} />
                  <Route path="companies/:id/:tab?" element={<CompanyPage />} />
                  <Route path="rating" element={<RatingPage />} />
                  <Route path="enterprises/:id" element={<EnterprisePage />} />
                  <Route path="vacancies" element={<VacanciesPage tab="listings" />} />
                  <Route path="vacancies/professions" element={<VacanciesPage tab="professions" />} />
                  <Route path="vacancies/:id" element={<VacancyPage />} />
                  <Route path="regions/:id" element={<RegionPage />} />
                  <Route path="methodology" element={<MethodologyPage />} />
                  <Route path="open-data" element={<OpenDataPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </AgentProvider>
          </FiltersProvider>
        </DataProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
