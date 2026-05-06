"""Backend API tests for OFM Dashboard"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json().get('ok') is True

class TestStats:
    def test_stats_returns_expected_fields(self):
        r = requests.get(f"{BASE_URL}/api/stats")
        assert r.status_code == 200
        d = r.json()
        assert 'bot_status' in d
        assert 'active_tenants' in d
        assert 'pending_drafts' in d
        assert 'replied_today' in d
        assert 'blocked_users' in d
        assert d['bot_status'] in ('running', 'stopped')

class TestBotControl:
    def test_bot_status(self):
        r = requests.get(f"{BASE_URL}/api/bot/status")
        assert r.status_code == 200
        assert r.json().get('status') in ('running', 'stopped')

    def test_bot_stop(self):
        r = requests.post(f"{BASE_URL}/api/bot/stop")
        assert r.status_code == 200
        assert r.json().get('status') in ('stopped', 'not_running')

    def test_bot_start(self):
        r = requests.post(f"{BASE_URL}/api/bot/start")
        assert r.status_code == 200
        # May start or report already_running
        assert r.json().get('status') in ('started', 'already_running')

class TestTenants:
    tenant_id = None

    def test_list_tenants_empty_or_array(self):
        r = requests.get(f"{BASE_URL}/api/tenants")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_tenant(self):
        payload = {
            "name": "TEST_tenant_001",
            "of_user_id": "test_uid_001",
            "of_cookie": "test_cookie",
            "of_x_bc": "test_xbc",
            "anthropic_api_key": "test_key",
            "claude_model": "claude-sonnet-4-6",
            "system_prompt": "Test prompt",
        }
        r = requests.post(f"{BASE_URL}/api/tenants", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d['name'] == "TEST_tenant_001"
        assert d['of_user_id'] == "test_uid_001"
        assert 'id' in d
        # has_cookie/has_xbc depend on ENCRYPTION_KEY being set; just verify keys exist
        assert 'has_cookie' in d
        assert 'has_xbc' in d
        TestTenants.tenant_id = d['id']

    def test_get_tenant(self):
        if not TestTenants.tenant_id:
            pytest.skip("No tenant created")
        r = requests.get(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}")
        assert r.status_code == 200
        assert r.json()['id'] == TestTenants.tenant_id

    def test_update_tenant(self):
        if not TestTenants.tenant_id:
            pytest.skip("No tenant created")
        r = requests.put(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}", json={"system_prompt": "Updated prompt"})
        assert r.status_code == 200
        assert r.json()['system_prompt'] == "Updated prompt"

    def test_disable_tenant(self):
        if not TestTenants.tenant_id:
            pytest.skip("No tenant created")
        r = requests.post(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}/disable")
        assert r.status_code == 200
        assert r.json()['enabled'] is False

    def test_enable_tenant(self):
        if not TestTenants.tenant_id:
            pytest.skip("No tenant created")
        r = requests.post(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}/enable")
        assert r.status_code == 200
        assert r.json()['enabled'] is True

    def test_delete_tenant(self):
        if not TestTenants.tenant_id:
            pytest.skip("No tenant created")
        r = requests.delete(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}")
        assert r.status_code == 200
        # Verify deletion
        r2 = requests.get(f"{BASE_URL}/api/tenants/{TestTenants.tenant_id}")
        assert r2.status_code == 404

class TestDrafts:
    def test_get_drafts_returns_array(self):
        r = requests.get(f"{BASE_URL}/api/drafts")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

class TestLogs:
    def test_get_logs(self):
        r = requests.get(f"{BASE_URL}/api/logs")
        assert r.status_code == 200
        assert 'lines' in r.json()
        assert isinstance(r.json()['lines'], list)
