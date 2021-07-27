import os
from dotenv import load_dotenv
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import requests
import json
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VideoGrant, ChatGrant
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

load_dotenv()
twilio_account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
twilio_api_key_sid = os.environ.get('TWILIO_API_KEY_SID')
twilio_api_key_secret = os.environ.get('TWILIO_API_KEY_SECRET')
twilio_client = Client(twilio_api_key_sid, twilio_api_key_secret,
                       twilio_account_sid)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY")
socketio = SocketIO(app)
# this will be a dictionary of the following pairs :::: {socket_id : [username,room_id]}
USERS = {}
USER_SOCKET_MAPPING = {}  # {username:socketid}


def get_chatroom(name):
    for conversation in twilio_client.conversations.conversations.list():
        if conversation.friendly_name == name:
            return conversation

    # a conversation with the given name does not exist ==> create a new one
    return twilio_client.conversations.conversations.create(
        friendly_name=name)


@app.route("/")  # we will make the url extension have the random hex number
def index():
    return render_template('index.html')

# @app.route("/run" , methods = ['POST'])
# def run_code():


@app.route('/login', methods=['POST'])
def login():
    username = request.get_json(force=True).get('username')
    room = request.get_json(force=True).get('room')
    if not username:
        abort(401)

    conversation = get_chatroom(room)
    try:
        conversation.participants.create(identity=username)
    except TwilioRestException as exc:
        # do not error if the user is already in the conversation
        if exc.status != 409:
            raise

    token = AccessToken(twilio_account_sid, twilio_api_key_sid,
                        twilio_api_key_secret, identity=username)
    token.add_grant(VideoGrant(room=room))
    token.add_grant(ChatGrant(service_sid=conversation.chat_service_sid))

    return {'token': token.to_jwt().decode(),
            'conversation_sid': conversation.sid}


@socketio.on('userdata')
def user_data(data):
    # the userdata that will come in will be username and room_id
    if 'username' in data:
        username = data['username']
        room = data['room_id']
        try:
            del USERS[USER_SOCKET_MAPPING[username]]  # try remove the previous
        except:
            print("This is a fresh user")
        finally:
            USER_SOCKET_MAPPING[username] = request.sid
        # new socket assigned to the user
        USERS[request.sid] = [username, room]
        join_room(room)  # the user joins the room
        emit('new user', data, room=room)


@socketio.on('new action')
def new_action(data):
    # find out who sent the data
    room = USERS[request.sid][1]
    emit('new paint', data, room=room)


@socketio.on('clear canvas')
def clear_canvas():
    room = USERS[request.sid][1]
    emit('clear canvas', room=room)


@socketio.on('get users')
def get_users():
    room = USERS[request.sid][1]
    users = []
    for key in USERS:
        if room == USERS[key][1]:
            users.append(USERS[key][0])
    emit('users', users, room=room)


@socketio.on('undo')
def undo():
    room = USERS[request.sid][1]
    emit('undo', room=room)


@socketio.on('leave room')
def exit_room():
    room = USERS[request.sid][1]
    leave_room(room)  # user has now left the room
    emit('user left', room=room)


@socketio.on('new msg')
def new_msg(data):
    room = USERS[request.sid][1]
    # data['username'] is the username of the person who sent the message
    emit('msg', data, room=room)


@socketio.on('submit code')
def submit_code(data):
    room = USERS[request.sid][1]
    print("request made", data)

    url = "http://sntc.iitmandi.ac.in:3000/submissions/?base64_encoded=false&wait=true"
    headers = {
        "cache-control": "no-cache",
        "Content-Type": "application/json"
    }

    body = {
        "source_code": data['src'],
        "language_id": data['lang'],
        "stdin": data['stdin'],
        "cpu_time_limit": "5"
    }

    print(body)
    response = requests.post(url, headers=headers,
                             data=json.dumps(body, indent=4))
    print(response.status_code)
    print(response.content)

    data['stdout'] = response.json()['stdout']

    emit('code run', data, room=room)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(
        os.environ.get("PORT", 5000)), debug=True)
