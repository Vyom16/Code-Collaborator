document.addEventListener("DOMContentLoaded", () => {
  get_username(); //when the user first logs in, they are prompted to enter their username
});

var socket;

let bootstrap_colours = ["primary", "secondary", "success", "danger", "warning", "info"];

const init = (username, room_id) => {
  document.getElementById('username').value = username;
  document.getElementById('room').value = room_id;
  document.getElementById('join_leave').click();
  //after the username is entered, lets start the socket
  socket = io.connect(
    location.protocol + "//" + document.domain + ":" + location.port
  );


  socket.on("connect", () => {

    socket.emit("userdata", { username, room_id }); // let the server know what the user's name is
    socket.emit("get users");

    setup(socket, username, room_id);

    socket.on("new user", data => {
      show_user_in_list(data.username)
    });

    socket.on("msg", data => {
      let username = data["username"];
      let msg = data["msg"];
      show_msg(username, msg, data["type_of_message"])

    });

    socket.on("user left", () => {
      socket.emit("get users");
      //if the server tells us someone who left, we want to know who left and therefore update the user list
    });

    socket.on("users", data => {
      clear_users();
      for (let name of data) {
        if (name !== localStorage.getItem("username")) {
          show_user_in_list(name);
        }
      }
    });


    socket.on("new paint", data => {
      //see how youre going to do the color and thickeness
      if (data.username !== localStorage.getItem("username")) {
        draw_point(data.x, data.y, data.connect, data.color, data.thickness, data.action);
      }
    })

    socket.on("clear canvas", () => {
      clear_canvas();
    })

    socket.on("undo", () => {
      //see how youre going to do the color and thickeness
      undo();
    })


    socket.on("code run", (data) => {
      // Run the code and make the changes
      console.log("data of code run", data)
      $('#submit-btn').html('Submit')
      $('#submit-btn').prop('disabled', false);

      document.getElementById('stdout').innerHTML = data.stdout
      document.getElementById('stdin').innerHTML = data.stdin

    })

  });

  function show_user_in_list(name) {
    var colour = bootstrap_colours[Math.floor(Math.random() * bootstrap_colours.length)];
    $("#active_users_list").append(`<span class=\"badge badge-pill badge-${colour}\">${name}</span>`);
  }



  // The main Code editor realtime using firebase here

  // Get the editor id, using Url.js
  // The queryString method returns the value of the id querystring parameter
  // We default to "_", for users which do not use a custom id.

  // WE need to add a wait till room_id is got
  var editorId = room_id;

  // This is the local storage field name where we store the user theme
  // We set the theme per user, in the browser's local storage
  var LS_THEME_KEY = "editor-theme";

  // This function will return the user theme or the Monokai theme (which
  // is the default)
  function getTheme() {
    return localStorage.getItem(LS_THEME_KEY) || "ace/theme/monokai";
  }

  // Select the desired theme of the editor
  $("#select-theme").change(function () {
    // Set the theme in the editor
    editor.setTheme(this.value);

    // Update the theme in the localStorage
    // We wrap this operation in a try-catch because some browsers don't
    // support localStorage (e.g. Safari in private mode)
    try {
      localStorage.setItem(LS_THEME_KEY, this.value);
    } catch (e) { }
  }).val(getTheme());

  // Select the desired programming language you want to code in 
  var $selectLang = $("#select-lang").change(function () {
    // Set the language in the Firebase object
    // This is a preference per editor
    currentEditorValue.update({
      lang: this.value
    });
    // Set the editor language
    editor.getSession().setMode("ace/mode/" + this.value);
  });

  // Generate a pseudo user id
  // This will be used to know if it's me the one who updated
  // the code or not
  var uid = Math.random().toString();
  var editor = null;
  // Make a reference to the database
  var db = firebase.database();

  // Write the entries in the database 
  var editorValues = db.ref("editor_values");

  // Get the current editor reference
  var currentEditorValue = editorValues.child(editorId);

  // Store the current timestamp (when we opened the page)
  // It's quite useful to know that since we will
  // apply the changes in the future only
  var openPageTimestamp = Date.now();

  // Take the editor value on start and set it in the editor
  currentEditorValue.child("content").once("value", function (contentRef) {

    document.getElementById('editor-spinner').style.display = "none";

    // Somebody changed the lang. Hey, we have to update it in our editor too!
    currentEditorValue.child("lang").on("value", function (r) {
      var value = r.val();
      // Set the language
      console.log("lang value", value);
      document.getElementById('language').value = value;
      changeEditorLang(value);
    });

    // Initialize the ACE editor
    editor = ace.edit("editor");
    editor.setTheme("ace/theme/chrome");
    editor.session.setMode("ace/mode/c_cpp");
    editor.setFontSize("16px");

    // Get the queue reference
    var queueRef = currentEditorValue.child("queue");

    // This boolean is going to be true only when the value is being set programmatically
    // We don't want to end with an infinite cycle, since ACE editor triggers the
    // `change` event on programmatic changes (which, in fact, is a good thing)
    var applyingDeltas = false;

    // When we change something in the editor, update the value in Firebase
    editor.on("change", function (e) {

      // In case the change is emitted by us, don't do anything
      // (see below, this boolean becomes `true` when we receive data from Firebase)
      if (applyingDeltas) {
        return;
      }

      // Set the content in the editor object
      // This is being used for new users, not for already-joined users.
      currentEditorValue.update({
        content: editor.getValue()
      });

      // Generate an id for the event in this format:
      //  <timestamp>:<random>
      // We use a random thingy just in case somebody is saving something EXACTLY
      // in the same moment
      queueRef.child(Date.now().toString() + ":" + Math.random().toString().slice(2)).set({
        event: e,
        by: uid
      }).catch(function (e) {
        console.error(e);
      });
    });

    // Get the editor document object 
    var doc = editor.getSession().getDocument();

    // Listen for updates in the queue
    queueRef.on("child_added", function (ref) {

      // Get the timestamp
      var timestamp = ref.key.split(":")[0];

      // Do not apply changes from the past
      if (openPageTimestamp > timestamp) {
        return;
      }

      // Get the snapshot value
      var value = ref.val();

      // In case it's me who changed the value, I am
      // not interested to see twice what I'm writing.
      // So, if the update is made by me, it doesn't
      // make sense to apply the update
      if (value.by === uid) { return; }

      // We're going to apply the changes by somebody else in our editor
      //  1. We turn applyingDeltas on
      applyingDeltas = true;
      //  2. Update the editor value with the event data
      doc.applyDeltas([value.event]);
      //  3. Turn off the applyingDeltas
      applyingDeltas = false;
    });

    // Get the current content
    var val = contentRef.val();

    // If the editor doesn't exist already....
    if (val === null) {
      // ...we will initialize a new one. 
      // ...with this content:
      val = "// Hello World"

      // Here's where we set the initial content of the editor
      editorValues.child(editorId).set({
        lang: "10",
        queue: {},
        content: val
      });
    }

    // We're going to update the content, so let's turn on applyingDeltas 
    applyingDeltas = true;

    // ...then set the value
    // -1 will move the cursor at the begining of the editor, preventing
    // selecting all the code in the editor (which is happening by default)
    editor.setValue(val, -1);

    // ...then set applyingDeltas to false
    applyingDeltas = false;

    // And finally, focus the editor!
    editor.focus();
  });


  changeEditorLang = (lang_enum) => {
    if (lang_enum == 10 || lang_enum == 4) {
      editor.session.setMode("ace/mode/c_cpp");
    }
    else if (lang_enum == 34 || lang_enum == 36) {
      editor.session.setMode("ace/mode/python");
    }
    else if (lang_enum == 27) {
      editor.session.setMode("ace/mode/java");
    }
  }


  resetEditorLang = (lang_enum) => {
    console.log("reset editor lang");
    if (lang_enum == 10 || lang_enum == 4) {
      editor.session.setMode("ace/mode/c_cpp");
      var dummycpp =
        `#include <bits/stdc++.h>
using namespace std;

int main(){
    // Your code starts here

    return 0;
}`
      var dummyc =
        `#include <stdio.h>
int main(void){
    // Your code starts here

    return 0;
}`
      if (lang_enum == 4)
        editor.setValue(dummyc);
      else
        editor.setValue(dummycpp);
    }
    else if (lang_enum == 34 || lang_enum == 36) {
      editor.session.setMode("ace/mode/python");
      editor.setValue("#Your code here")
    }
    else if (lang_enum == 27) {
      editor.session.setMode("ace/mode/java");
      var dummyjava =
        `public class Main {
    public static void main(String[] args) {
        System.out.println("hello, world");
    }
}`
      editor.setValue(dummyjava);
    }
  }


  // Code submit and language change
  $('#submit-btn').on('click', function () {

    console.log("Response");

    $('#submit-btn').html('<i class="fa fa-spinner fa-spin"></i>');
    $('#submit-btn').prop('disabled', true);
    data = {
      src: editor.getValue(),
      lang: $('#language').val(),
      stdin: $('#stdin').val()
    };
    socket.emit("submit code", data)
    $('#submit-btn').prop('disabled', false);
  });

  $("#language").change(function () {
    console.log("language changed!!");
    var lang_enum = $(this).val();

    currentEditorValue.child("lang").set(lang_enum);

    resetEditorLang(lang_enum);
  });

};

const setup = (socket, username, room_id) => {
  let msg_inp = document.querySelector("#msg-text");
  let msg_form = document.querySelector("#msg-form");

  msg_form.addEventListener("submit", e => {
    console.log("the form was submitted")
    // no reloading
    e.preventDefault();

    let msg = msg_inp.value; //this is what the user has entered as a message

    socket.emit("new msg", {
      msg,
      room_id: room_id,
      username: username,
      type_of_message: "message"
    });//send the message data to the socket

    msg_inp.value = "";
  });
}

const show_msg = (username, msg, type_of_message) => {
  let ul = document.querySelector("#msg-list");
  let li = document.createElement("li");

  if (localStorage.getItem("username") === username) {
    //if i sent the message
    li.classList.add("list-group-me");
    switch (type_of_message) {
      case "message": {
        li.innerHTML = `<strong class="d-flex justify-content-end">${msg
          } </strong>`
        break;
      }
      case "gif": {
        li.innerHTML = `<img style="width:100%;"src=${msg} alt="A GIF">`
        break;
      }
      default:
        console.log("there was an error displaying your message")

    }

  } else {
    //if the message is from someone else.
    li.classList.add("list-group-sender");
    switch (type_of_message) {
      case "message": {
        li.innerHTML = `<strong>${username}</strong>: ${msg
          }`;
        break;
      }
      case "gif": {
        li.innerHTML = `<strong>${username}</strong><img style="display:block;width:100%;"src=${msg} alt="A GIF">`;
        break;
      }
      default:
        console.log("there was an error displaying their message")
    }

  }

  ul.appendChild(li);
  // scroll msg-list
  ul.scrollTop = ul.scrollHeight - ul.clientHeight;

};

function create_room() {
  //  random hex string generator of length 16 chars
  let room_id = randHex(16);
  let username = localStorage.getItem("username");
  localStorage.setItem("room_id", room_id);
  try {
    document.getElementById('navbar_header').innerHTML = "Room ID: " + room_id;
    socket.emit("userdata", { username, room_id })
  }
  catch (err) {
    document.getElementById('navbar_header').innerHTML = "Room ID: " + room_id;
    init(username, room_id);
  }
}

//function to get the room_id from the user through using a modal
const get_session_room = () => {
  let room_id = localStorage.getItem("room_id");
  let username = localStorage.getItem("username");

  if (!room_id) {
    //open the modal for the user to enter the room id or just to practise solo.
    //if they choose room id, they will go to it
    //if they choose to practise solo, then they will have a canvas to themselves with no other users
    $("#room_id_Modal").modal({ show: true, backdrop: "static" });
    document.querySelector("#room_id-form").addEventListener("submit", e => {
      e.preventDefault(); //prevents the default action from happening which is reloading the page etc
      room_id = document.querySelector("#room_id-text").value;
      if (typeof room_id == "string") {
        room_id = room_id.trim(); //removes whitespace from the string
        if (room_id == "") {
          room_id = null;
          $('#room_id-title-1').text("Please enter a valid Room ID");
          $('#room_id-title-1').css('color', 'red');
          //add text on the modal to let the user know they need to enter someting in the modal
        } else {
          localStorage.setItem("room_id", room_id);
          $("#room_id_Modal").modal("hide");
          try {
            //this will happen if the socket was already created and the user just left the previous room and enters a new one.
            document.getElementById('navbar_header').innerHTML = "Room ID: " + room_id;
            socket.emit("userdata", { username, room_id })
          }
          catch (err) {
            document.getElementById('navbar_header').innerHTML = "Room ID: " + room_id;
            init(username, room_id);
          }
        }
      }
    });
  } else {
    //the user will not reach here if they have left a room.
    document.getElementById('navbar_header').innerHTML = "Room ID: " + room_id;
    init(username, room_id);
  }
};

//function to get the username from the user through using a modal
const get_username = () => {

  let username = localStorage.getItem("username");

  if (!username) {
    //if the user has no username in local storage, then lets get it.
    $("#usernameModal").modal({ show: true, backdrop: "static" });

    document.querySelector("#username-form").addEventListener("submit", e => {
      e.preventDefault(); //prevents the default action from happening

      username = document.querySelector("#username-text").value; //get the username from the modal

      console.log(username);

      if (typeof username == "string") {
        username = username.trim(); //removes whitespace from the string
        if (username == "") {
          username = null;
          $('#usernameModal-title-1').text("Please enter your username below");
          $('#usernameModal-title-1').css('color', 'red');
          //add text on the modal to let the user know they need to enter someting in the modal
        } else {
          localStorage.setItem("username", username);

          $("#usernameModal").modal("hide");
          //set the username in local storage to make it like sessions
          get_session_room();
          //call the init function to start the app
        }
      }
    });
  } else {
    get_session_room();
  };
};

function openChat() {
  document.getElementById("chatRoom").style.width = "360px";
  document.getElementById('msg-text').focus();

}

function closeChat() {
  document.getElementById("chatRoom").style.width = "0";
}

//generate a string of hex characters of desired length
var randHex = function (len) {
  var maxlen = 8,
    min = Math.pow(16, Math.min(len, maxlen) - 1)
  max = Math.pow(16, Math.min(len, maxlen)) - 1,
    n = Math.floor(Math.random() * (max - min + 1)) + min,
    r = n.toString(16);
  while (r.length < len) {
    r = r + randHex(len - maxlen);
  }
  return r;
};

const clear_users = () => {
  let ul = document.querySelector("#active_users_list");
  ul.innerHTML = "";
};

function leaveRoom() {
  localStorage.removeItem("room_id");
  clear_canvas();
  document.querySelector("#msg-list").innerHTML = "";
  socket.emit("leave room");
  get_session_room()
}
